/**
 * POST /v1/analysis/sequential - Sequential Decision Analysis Proxy
 *
 * Validates sequential graph structure, runs multi-stage inference,
 * then forwards to ISL /api/v1/analysis/sequential for optimal policy.
 *
 * Phase 4: Sequential graph support
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { detectPrimaryOutcome } from '../../services/ranking/outcome-detector.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { validateSequentialGraph, getMaxStage } from '../../util/sequential-validation.js';
import { isFlagOn } from '../../cee/codes.js';
import { islService, toPublicIslError } from '../../integrations/isl/index.js';
import type {
  SequentialAnalysisRequest,
  SequentialAnalysisResponse,
  IslSequentialAnalysisResponse,
  StageOptimalDecision,
} from './types/proxy.types.js';
import {
  shouldAllowIslCall,
  recordIslSuccess,
  recordIslFailure,
} from '../../integrations/isl-circuit-breaker.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

const MAX_STAGES = 10;
const DEFAULT_K_SAMPLES = 32;

/**
 * Compute local sequential analysis when ISL is unavailable
 * Simple greedy approach: pick best option at each stage
 */
function computeLocalSequentialAnalysis(
  stageResults: Array<{
    stage: number;
    stage_label: string;
    options: Array<{
      option_id: string;
      label: string;
      score: number;
      distribution: { p10: number; p50: number; p90: number };
    }>;
  }>,
  discountFactor: number
): IslSequentialAnalysisResponse {
  const stageDecisions: StageOptimalDecision[] = [];
  let overallExpectedValue = 0;
  const keyUncertainties: string[] = [];

  for (const stage of stageResults) {
    if (stage.options.length === 0) continue;

    // Sort by score descending
    const sorted = [...stage.options].sort((a, b) => b.score - a.score);
    const winner = sorted[0];

    // Apply discount factor based on stage
    const discountedValue = winner.score * Math.pow(discountFactor, stage.stage);
    overallExpectedValue += discountedValue;

    // Determine confidence based on margin
    const margin = sorted.length > 1 ? winner.score - sorted[1].score : 0;
    const confidence = margin > 0.2 ? 'high' : margin > 0.1 ? 'medium' : 'low';

    stageDecisions.push({
      stage: stage.stage,
      stage_label: stage.stage_label,
      decision_id: `stage_${stage.stage}_decision`,
      optimal_option_id: winner.option_id,
      optimal_option_label: winner.label,
      expected_value: Math.round(discountedValue * 1000) / 1000,
      confidence,
    });

    // Track uncertainties from low-confidence decisions
    if (confidence === 'low') {
      keyUncertainties.push(`Stage ${stage.stage} (${stage.stage_label}): close alternatives`);
    }
  }

  // Determine overall confidence
  const lowConfidenceCount = stageDecisions.filter((d) => d.confidence === 'low').length;
  const overallConfidence =
    lowConfidenceCount === 0 ? 'high' : lowConfidenceCount === 1 ? 'medium' : 'low';

  // Build strategy summary
  const strategySummary =
    stageDecisions.length > 0
      ? `Optimal strategy: ${stageDecisions.map((d) => `${d.stage_label}→${d.optimal_option_label}`).join(', ')}`
      : 'No sequential decisions found';

  return {
    stage_decisions: stageDecisions,
    overall_expected_value: Math.round(overallExpectedValue * 1000) / 1000,
    overall_confidence: overallConfidence,
    strategy_summary: strategySummary,
    key_uncertainties: keyUncertainties,
  };
}

export async function registerSequentialAnalysisRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/sequential',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as SequentialAnalysisRequest;
      const requestId = String(req.id);

      // Check feature flag - ENABLE_SEQUENTIAL_ANALYSIS
      const featureEnabled = isFlagOn(process.env.ENABLE_SEQUENTIAL_ANALYSIS);
      if (!featureEnabled) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 501,
          message:
            'Sequential analysis is not enabled. Set ENABLE_SEQUENTIAL_ANALYSIS=1 to enable.',
          fields: { feature: 'sequential_analysis' },
        });
      }

      // Validate graph
      if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'graph.nodes required',
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.nodes.length > MAX_NODES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_NODES} nodes`,
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.edges && body.graph.edges.length > MAX_EDGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_EDGES} edges`,
          fields: { field: 'graph.edges' },
        });
      }

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
        sequential_metadata: body.graph.sequential_metadata,
      };

      // Validate sequential structure
      const validation = validateSequentialGraph(graph);
      const maxStage = getMaxStage(graph);

      if (maxStage > MAX_STAGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_STAGES} stages`,
          fields: { field: 'graph.sequential_metadata.stages' },
        });
      }

      // Return early with validation errors if severe
      if (!validation.valid) {
        const errors = validation.issues.filter((i) => i.severity === 'error');
        if (errors.length > 0) {
          return replyWithAppError(reply, {
            type: 'BAD_INPUT',
            statusCode: 400,
            message: `Sequential validation failed: ${errors[0].message}`,
            fields: { code: errors[0].code },
          });
        }
      }

      // Get discount factor.
      //
      // Read as a number even when the client sent a numeric string. Without
      // this the raw string reached `Math.pow` (which coerced it silently), the
      // ISL request body, and `model_card.discount_factor` — whose declared type
      // is `number` — so the response echoed `"0.95"` while the accompanying
      // COERCED_DISCOUNT_FACTOR warning said it had been read as `0.95`. The
      // response must not say two different things about one value.
      // `validateSequentialGraph` has already blocked a non-coercible
      // `sequential_metadata.default_discount_factor`; the range check below
      // still guards the top-level `discount_factor`, which nothing validates.
      const rawDiscountFactor =
        body.discount_factor ??
        body.graph.sequential_metadata?.default_discount_factor ??
        1.0;
      const discountFactor =
        typeof rawDiscountFactor === 'number' ? rawDiscountFactor : Number(rawDiscountFactor);

      if (discountFactor < 0 || discountFactor > 1) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'discount_factor must be between 0 and 1',
          fields: { field: 'discount_factor' },
        });
      }

      // Detect outcome node
      const seed = body.seed ?? 4242;
      let outcomeNode = body.outcome_node ?? '';

      if (!outcomeNode) {
        const detection = detectPrimaryOutcome(graph);
        if (detection.detected && detection.node_id) {
          outcomeNode = detection.node_id;
        } else {
          outcomeNode = graph.nodes[graph.nodes.length - 1]?.id ?? '';
        }
      }

      // Group nodes by stage
      const nodesByStage = new Map<number, any[]>();
      for (const node of graph.nodes) {
        const stage = node.stage ?? 0;
        const stageNodes = nodesByStage.get(stage) ?? [];
        stageNodes.push(node);
        nodesByStage.set(stage, stageNodes);
      }

      // Run inference for each stage's options
      const inferenceEngine = getInferenceEngine('model_based');
      const stageResults: Array<{
        stage: number;
        stage_label: string;
        options: Array<{
          option_id: string;
          label: string;
          score: number;
          distribution: { p10: number; p50: number; p90: number };
        }>;
      }> = [];

      const stages = graph.sequential_metadata?.stages ?? [];
      const sortedStages = [...nodesByStage.keys()].sort((a, b) => a - b);

      for (const stageIndex of sortedStages) {
        const stageNodes = nodesByStage.get(stageIndex) ?? [];
        const stageDef = stages.find((s: any) => s.index === stageIndex);
        const stageLabel = stageDef?.label ?? `Stage ${stageIndex}`;

        // Find option nodes in this stage
        const optionNodes = stageNodes.filter(
          (n: any) => n.kind === 'option' || n.kind === 'action' || n.kind === 'decision'
        );

        const stageOptions: Array<{
          option_id: string;
          label: string;
          score: number;
          distribution: { p10: number; p50: number; p90: number };
        }> = [];

        for (let i = 0; i < optionNodes.length; i++) {
          const optionNode = optionNodes[i];
          const optionSeed = seed + stageIndex * 100 + i + 1;

          try {
            const result = await inferenceEngine.run(graph, {
              seed: optionSeed,
              k_samples: DEFAULT_K_SAMPLES,
              outcome_node: outcomeNode,
              baseline_value: 100,
              adaptiveK: true,
            });

            stageOptions.push({
              option_id: optionNode.id,
              label: optionNode.label || optionNode.id,
              score: Math.round(result.most_likely.outcome * 1000) / 1000,
              distribution: {
                p10: Math.round(result.conservative.outcome * 1000) / 1000,
                p50: Math.round(result.most_likely.outcome * 1000) / 1000,
                p90: Math.round(result.optimistic.outcome * 1000) / 1000,
              },
            });
          } catch (err: any) {
            req.log.warn({
              evt: 'sequential_inference_error',
              stage: stageIndex,
              option_id: optionNode.id,
              error: err.message,
            });
          }
        }

        if (stageOptions.length > 0) {
          stageResults.push({
            stage: stageIndex,
            stage_label: stageLabel,
            options: stageOptions,
          });
        }
      }

      // Call ISL if enabled
      let analysis: IslSequentialAnalysisResponse | null = null;
      let islError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';

      const islEnabled = isFlagOn(
        process.env.ISL_SEQUENTIAL_ENABLE ?? process.env.ISL_ENABLE
      );

      if (islEnabled && stageResults.length > 0) {
        // Check circuit breaker before ISL call
        const cbCheck = shouldAllowIslCall();
        if (!cbCheck.allowed) {
          req.log.info({
            evt: 'sequential_circuit_breaker',
            id: requestId,
            reason: cbCheck.reason,
          });
          islError = {
            code: 'ISL_CIRCUIT_BREAKER_OPEN',
            message: cbCheck.reason || 'ISL circuit breaker is open',
            retryable: true,
          };
        } else {
          req.log.info({
            evt: 'sequential_isl_call',
            id: requestId,
            stage_count: stageResults.length,
          });

          const islResult = await islService.callAnalysisEndpoint<IslSequentialAnalysisResponse>(
            '/api/v1/analysis/sequential',
            {
              plot_request_id: requestId,
              stage_results: stageResults,
              discount_factor: discountFactor,
            },
            requestId
          );

          analysis = islResult.data;
          islError = toPublicIslError(islResult.error);

          // Record result with circuit breaker
          if (analysis) {
            recordIslSuccess();
            provenance = 'isl';
          } else if (islError?.retryable) {
            recordIslFailure();
          }
        }
      }

      // Use local fallback if ISL unavailable
      if (!analysis) {
        analysis = computeLocalSequentialAnalysis(stageResults, discountFactor);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'sequential_analysis',
        id: requestId,
        stage_count: stageResults.length,
        overall_expected_value: analysis.overall_expected_value,
        provenance,
        duration_ms: duration,
      });

      const response: SequentialAnalysisResponse = {
        schema: 'sequential_analysis.v1',
        analysis,
        validation: {
          valid: validation.valid,
          stage_count: validation.stage_count,
          issues: validation.issues.map((i) => ({
            code: i.code,
            message: i.message,
            severity: i.severity,
          })),
        },
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          stages: stageResults.length,
          discount_factor: discountFactor,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
