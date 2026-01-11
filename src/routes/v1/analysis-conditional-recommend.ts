/**
 * POST /v1/analysis/conditional-recommend - Conditional Recommendation Proxy
 *
 * Runs inference with applied conditions, then forwards to
 * ISL /api/v1/analysis/conditional-recommend for conditional recommendation.
 *
 * Phase 4: Sequential graph support
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { detectPrimaryOutcome } from '../../services/ranking/outcome-detector.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { isFlagOn } from '../../cee/codes.js';
import { islService } from '../../integrations/isl/index.js';
import { validateSequentialGraph, isSequentialGraph } from '../../util/sequential-validation.js';
import type {
  ConditionalRecommendRequest,
  ConditionalRecommendResponse,
  IslConditionalRecommendResponse,
  RecommendationCondition,
} from './types/proxy.types.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

const MAX_CONDITIONS = 20;
const DEFAULT_K_SAMPLES = 32;

/**
 * Compute local conditional recommendation when ISL is unavailable
 */
function computeLocalConditionalRecommend(
  options: Array<{
    option_id: string;
    label: string;
    score: number;
    distribution: { p10: number; p50: number; p90: number };
  }>,
  conditions: RecommendationCondition[]
): IslConditionalRecommendResponse {
  // Sort by score descending
  const sorted = [...options].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const alternatives = sorted.slice(1, 4);

  return {
    recommendation: winner.option_id,
    recommendation_label: winner.label,
    expected_score: winner.score,
    conditional_distribution: winner.distribution,
    confidence: 'medium',
    alternatives: alternatives.map((alt, i) => ({
      option_id: alt.option_id,
      label: alt.label,
      score: alt.score,
      trade_off: `${Math.round((winner.score - alt.score) * 100)}% lower expected value`,
    })),
    conditions_applied: conditions,
  };
}

/**
 * Apply conditions to graph by setting node values
 */
function applyConditionsToGraph(
  graph: any,
  conditions: RecommendationCondition[]
): any {
  const modifiedGraph = {
    ...graph,
    nodes: graph.nodes.map((node: any) => {
      const condition = conditions.find((c) => c.node_id === node.id);
      if (condition && typeof condition.value === 'number') {
        return { ...node, value: condition.value };
      }
      return node;
    }),
  };
  return modifiedGraph;
}

export async function registerConditionalRecommendRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/conditional-recommend',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as ConditionalRecommendRequest;
      const requestId = String(req.id);

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

      // Validate conditions
      if (!body.conditions || !Array.isArray(body.conditions)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'conditions array required',
          fields: { field: 'conditions' },
        });
      }

      if (body.conditions.length > MAX_CONDITIONS) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `conditions exceeds max ${MAX_CONDITIONS}`,
          fields: { field: 'conditions' },
        });
      }

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      let graph: any = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
        sequential_metadata: body.graph.sequential_metadata,
      };

      // Validate sequential structure if present (P0.3: consistent validation)
      const sequentialWarnings: string[] = [];
      if (isSequentialGraph(graph)) {
        const validation = validateSequentialGraph(graph);
        for (const issue of validation.issues) {
          if (issue.severity === 'error') {
            return replyWithAppError(reply, {
              type: 'BAD_INPUT',
              statusCode: 400,
              message: `Sequential validation failed: ${issue.message}`,
              fields: { field: 'graph.sequential_metadata', code: issue.code },
            });
          }
          sequentialWarnings.push(issue.message);
        }
      }

      // Apply conditions to graph
      graph = applyConditionsToGraph(graph, body.conditions);

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

      // Find option nodes
      const optionNodes = graph.nodes.filter(
        (n: any) => n.kind === 'option' || n.kind === 'action'
      );

      if (optionNodes.length < 1) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'At least 1 option or action node required for recommendation',
          fields: { field: 'graph.nodes' },
        });
      }

      // Run inference for each option
      const inferenceEngine = getInferenceEngine('model_based');
      const optionResults: Array<{
        option_id: string;
        label: string;
        score: number;
        distribution: { p10: number; p50: number; p90: number };
      }> = [];

      for (let i = 0; i < optionNodes.length; i++) {
        const optionNode = optionNodes[i];
        const optionSeed = seed + i + 1;

        try {
          const result = await inferenceEngine.run(graph, {
            seed: optionSeed,
            k_samples: DEFAULT_K_SAMPLES,
            outcome_node: outcomeNode,
            baseline_value: 100,
            adaptiveK: true,
          });

          const p50 = result.most_likely.outcome;
          optionResults.push({
            option_id: optionNode.id,
            label: optionNode.label || optionNode.id,
            score: Math.round(p50 * 1000) / 1000,
            distribution: {
              p10: Math.round(result.conservative.outcome * 1000) / 1000,
              p50: Math.round(p50 * 1000) / 1000,
              p90: Math.round(result.optimistic.outcome * 1000) / 1000,
            },
          });
        } catch (err: any) {
          req.log.warn({
            evt: 'conditional_recommend_inference_error',
            option_id: optionNode.id,
            error: err.message,
          });
        }
      }

      if (optionResults.length < 1) {
        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'Inference failed for all options',
          fields: { code: 'INFERENCE_FAILED' },
        });
      }

      // Sort by score descending
      optionResults.sort((a, b) => b.score - a.score);

      // Call ISL if enabled
      let recommendation: IslConditionalRecommendResponse | null = null;
      let islError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';

      const islEnabled = isFlagOn(
        process.env.ISL_CONDITIONAL_RECOMMEND_ENABLE ?? process.env.ISL_ENABLE
      );

      if (islEnabled) {
        req.log.info({
          evt: 'conditional_recommend_isl_call',
          id: requestId,
          option_count: optionResults.length,
          condition_count: body.conditions.length,
        });

        const islResult = await islService.callAnalysisEndpoint<IslConditionalRecommendResponse>(
          '/api/v1/analysis/conditional-recommend',
          {
            plot_request_id: requestId,
            options: optionResults,
            conditions: body.conditions,
          },
          requestId
        );

        recommendation = islResult.data;
        islError = islResult.error;

        if (recommendation) {
          provenance = 'isl';
        }
      }

      // Use local fallback if ISL unavailable
      if (!recommendation) {
        recommendation = computeLocalConditionalRecommend(optionResults, body.conditions);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'conditional_recommend_analysis',
        id: requestId,
        option_count: optionResults.length,
        condition_count: body.conditions.length,
        winner: recommendation.recommendation,
        provenance,
        duration_ms: duration,
      });

      const response: ConditionalRecommendResponse = {
        schema: 'conditional_recommend.v1',
        recommendation,
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          conditions_count: body.conditions.length,
        },
        ...(islError && { isl_error: islError }),
        ...(sequentialWarnings.length > 0 && { sequential_warnings: sequentialWarnings }),
      };

      return reply.code(200).send(response);
    }
  );
}
