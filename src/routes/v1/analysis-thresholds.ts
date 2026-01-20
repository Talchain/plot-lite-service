/**
 * POST /v1/analysis/thresholds - Threshold Identification Proxy
 *
 * Calls ISL's native /api/v1/analysis/thresholds endpoint for efficient
 * threshold detection in a single call. ISL handles parameter sweeps internally.
 *
 * Phase 2 Week 2: ISL integration (updated to use native ISL endpoint)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { detectPrimaryOutcome } from '../../services/ranking/outcome-detector.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { isFlagOn } from '../../cee/codes.js';
import { islService } from '../../integrations/isl/index.js';
import type {
  ThresholdRequest,
  ThresholdResponse,
  IslThresholdResponse,
  IslNativeThresholdRequest,
  IslNativeThresholdResponse,
  SweepResult,
  ThresholdPoint,
  SensitivityRanking,
  ProxyError,
} from './types/proxy.types.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

const MAX_SWEEPS = 5;
const MAX_VALUES_PER_SWEEP = 20;
const DEFAULT_K_SAMPLES = 16; // Lower samples for sweep efficiency

/**
 * Detect threshold crossings in sweep results
 */
function detectThresholdCrossings(sweepResults: SweepResult[]): ThresholdPoint[] {
  const thresholds: ThresholdPoint[] = [];

  for (const sweep of sweepResults) {
    const { scores } = sweep;
    if (scores.length < 2) continue;

    // Track ranking at each value
    for (let i = 1; i < scores.length; i++) {
      const prevScores = scores[i - 1].option_scores;
      const currScores = scores[i].option_scores;

      // Sort by score to get rankings
      const prevRanked = [...prevScores].sort((a, b) => b.score - a.score);
      const currRanked = [...currScores].sort((a, b) => b.score - a.score);

      // Check if top option changed
      if (prevRanked[0]?.option_id !== currRanked[0]?.option_id) {
        const prevValue = scores[i - 1].value;
        const currValue = scores[i].value;
        const thresholdValue = (prevValue + currValue) / 2;

        thresholds.push({
          sweep_id: sweep.sweep_id,
          node_id: sweep.node_id,
          parameter: sweep.parameter,
          threshold_value: Math.round(thresholdValue * 1000) / 1000,
          crossing_type: currRanked[0].score > prevRanked[0].score ? 'rising' : 'falling',
          options_affected: [prevRanked[0].option_id, currRanked[0].option_id],
          description: `${currRanked[0].option_id} overtakes ${prevRanked[0].option_id} when ${sweep.parameter} crosses ${thresholdValue.toFixed(2)}`,
        });
      }
    }
  }

  return thresholds;
}

/**
 * Calculate sensitivity scores for each sweep
 */
function calculateSensitivity(sweepResults: SweepResult[]): SensitivityRanking[] {
  const sensitivities: SensitivityRanking[] = [];

  for (const sweep of sweepResults) {
    const { scores } = sweep;
    if (scores.length < 2) continue;

    // Calculate score variance across sweep for top option
    const allScores = scores.flatMap((s) => s.option_scores.map((o) => o.score));
    const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const variance = allScores.reduce((a, b) => a + (b - mean) ** 2, 0) / allScores.length;
    const sensitivityScore = Math.sqrt(variance);

    sensitivities.push({
      sweep_id: sweep.sweep_id,
      node_id: sweep.node_id,
      parameter: sweep.parameter,
      sensitivity_score: Math.round(sensitivityScore * 1000) / 1000,
      rank: 0, // Will be assigned after sorting
    });
  }

  // Sort by sensitivity descending and assign ranks
  sensitivities.sort((a, b) => b.sensitivity_score - a.sensitivity_score);
  sensitivities.forEach((s, i) => {
    s.rank = i + 1;
  });

  return sensitivities;
}

/**
 * Compute local threshold analysis when ISL is unavailable
 */
function computeLocalThresholds(sweepResults: SweepResult[]): IslThresholdResponse {
  const thresholds = detectThresholdCrossings(sweepResults);
  const sensitivityRanking = calculateSensitivity(sweepResults);

  // Generate summary
  const summaryParts: string[] = [];
  if (thresholds.length > 0) {
    summaryParts.push(`Found ${thresholds.length} threshold crossing(s).`);
  } else {
    summaryParts.push('No threshold crossings detected.');
  }

  if (sensitivityRanking.length > 0) {
    const mostSensitive = sensitivityRanking[0];
    summaryParts.push(
      `Most sensitive parameter: ${mostSensitive.node_id}.${mostSensitive.parameter} (score: ${mostSensitive.sensitivity_score.toFixed(3)})`
    );
  }

  return {
    thresholds,
    sensitivity_ranking: sensitivityRanking,
    summary: summaryParts.join(' '),
  };
}

/**
 * Transform ISL native threshold response to PLoT's response format
 * Maintains backward compatibility with existing UI consumers
 */
function transformIslNativeResponse(
  islResponse: IslNativeThresholdResponse,
  sweepConfigs: Array<{ node_id: string; parameter: string; values: number[] }>
): { analysis: IslThresholdResponse; sweepResults: SweepResult[] } {
  // Transform thresholds to PLoT format
  const thresholds: ThresholdPoint[] = islResponse.thresholds.map((t, idx) => ({
    sweep_id: t.sweep_id ?? `sweep_${idx}`,
    node_id: t.node_id,
    parameter: t.parameter,
    threshold_value: Math.round(t.threshold_value * 1000) / 1000,
    crossing_type: t.crossing_type,
    options_affected: t.options_affected ?? (t.alternative_winner_id ? [t.alternative_winner_id] : []),
    description: t.description ?? `Threshold crossing at ${t.parameter} = ${t.threshold_value.toFixed(2)}`,
  }));

  // Transform sensitivity ranking to PLoT format
  const sensitivityRanking: SensitivityRanking[] = islResponse.sensitivity_ranking.map((s, idx) => ({
    sweep_id: s.sweep_id ?? `sweep_${idx}`,
    node_id: s.node_id,
    parameter: s.parameter,
    sensitivity_score: Math.round(s.sensitivity_score * 1000) / 1000,
    rank: s.rank,
  }));

  // Use ISL's sweep_results if provided, otherwise construct minimal sweep results
  let sweepResults: SweepResult[];
  if (islResponse.sweep_results && islResponse.sweep_results.length > 0) {
    sweepResults = islResponse.sweep_results;
  } else {
    // Construct minimal sweep results from config (ISL computed internally)
    sweepResults = sweepConfigs.map((config, idx) => ({
      sweep_id: `sweep_${idx}`,
      node_id: config.node_id,
      parameter: config.parameter,
      // ISL computed scores internally - we don't have per-value scores in this case
      scores: config.values.map((value) => ({
        value,
        option_scores: [], // ISL handled scoring internally
      })),
    }));
  }

  const analysis: IslThresholdResponse = {
    thresholds,
    sensitivity_ranking: sensitivityRanking,
    summary: islResponse.summary,
  };

  return { analysis, sweepResults };
}

export async function registerThresholdsRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/thresholds',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as ThresholdRequest;
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

      // Validate sweeps
      if (!body.sweeps || !Array.isArray(body.sweeps) || body.sweeps.length === 0) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'sweeps array required with at least one sweep configuration',
          fields: { field: 'sweeps' },
        });
      }

      if (body.sweeps.length > MAX_SWEEPS) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Maximum ${MAX_SWEEPS} sweeps allowed`,
          fields: { field: 'sweeps' },
        });
      }

      // Validate each sweep
      for (let i = 0; i < body.sweeps.length; i++) {
        const sweep = body.sweeps[i];
        if (!sweep.node_id || !sweep.parameter || !sweep.values?.length) {
          return replyWithAppError(reply, {
            type: 'BAD_INPUT',
            statusCode: 400,
            message: `sweep[${i}] requires node_id, parameter, and values`,
            fields: { field: `sweeps[${i}]` },
          });
        }
        if (sweep.values.length > MAX_VALUES_PER_SWEEP) {
          return replyWithAppError(reply, {
            type: 'BAD_INPUT',
            statusCode: 400,
            message: `sweep[${i}] exceeds max ${MAX_VALUES_PER_SWEEP} values`,
            fields: { field: `sweeps[${i}].values` },
          });
        }
      }

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const baseGraph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
      };

      // Detect outcome node
      const seed = body.seed ?? 4242;
      let outcomeNode = body.outcome_node ?? '';

      if (!outcomeNode) {
        const detection = detectPrimaryOutcome(baseGraph);
        if (detection.detected && detection.node_id) {
          outcomeNode = detection.node_id;
        } else {
          outcomeNode = baseGraph.nodes[baseGraph.nodes.length - 1]?.id ?? '';
        }
      }

      // Find option nodes
      const optionNodes = baseGraph.nodes.filter(
        (n: any) => n.kind === 'option' || n.kind === 'action'
      );

      if (optionNodes.length < 2) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'At least 2 option or action nodes required for threshold analysis',
          fields: { field: 'graph.nodes' },
        });
      }

      // Prepare options for ISL
      const options = optionNodes.map((n: any) => ({
        id: n.id,
        label: n.label || n.id,
      }));

      // Track results
      let analysis: IslThresholdResponse | null = null;
      let sweepResults: SweepResult[] = [];
      let islError: ProxyError | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';
      let islMs: number | undefined;
      let inferenceMs = 0;
      let totalEvaluations = 0;

      const islEnabled = isFlagOn(process.env.ISL_THRESHOLDS_ENABLE ?? process.env.ISL_ENABLE);

      // Try ISL native endpoint first (single call)
      if (islEnabled) {
        const islRequest: IslNativeThresholdRequest = {
          plot_request_id: requestId,
          graph: {
            nodes: baseGraph.nodes.map((n: any) => ({
              id: n.id,
              label: n.label,
              kind: n.kind,
              value: n.value,
            })),
            edges: baseGraph.edges.map((e: any) => ({
              from: e.from,
              to: e.to,
              weight: e.weight,
              belief: e.belief,
            })),
          },
          options,
          goal_node_id: outcomeNode,
          sweeps: body.sweeps,
          seed,
        };

        req.log.info({
          evt: 'thresholds_isl_native_call',
          id: requestId,
          sweeps_count: body.sweeps.length,
          options_count: options.length,
          goal_node_id: outcomeNode,
        });

        const islStart = Date.now();
        const islResult = await islService.callAnalysisEndpoint<IslNativeThresholdResponse>(
          '/api/v1/analysis/thresholds',
          islRequest,
          requestId
        );
        islMs = Date.now() - islStart;

        if (islResult.data) {
          // Transform ISL native response to PLoT format
          const transformed = transformIslNativeResponse(islResult.data, body.sweeps);
          analysis = transformed.analysis;
          sweepResults = transformed.sweepResults;
          provenance = 'isl';
          inferenceMs = islMs; // ISL handled inference internally
          // Estimate total evaluations: sweeps * values * options (ISL computed internally)
          totalEvaluations = body.sweeps.reduce(
            (sum, sweep) => sum + sweep.values.length * options.length,
            0
          );

          req.log.info({
            evt: 'thresholds_isl_native_success',
            id: requestId,
            thresholds_found: analysis.thresholds.length,
            isl_ms: islMs,
          });
        } else {
          islError = islResult.error;
          req.log.warn({
            evt: 'thresholds_isl_native_failed',
            id: requestId,
            error: islResult.error?.code,
            message: islResult.error?.message,
          });
        }
      }

      // Fall back to local N-call pattern if ISL unavailable
      if (!analysis) {
        req.log.info({
          evt: 'thresholds_local_fallback',
          id: requestId,
          reason: islError ? 'isl_error' : 'isl_disabled',
        });

        const inferenceEngine = getInferenceEngine('model_based');
        const localSweepResults: SweepResult[] = [];
        const inferenceStart = Date.now();

        for (let s = 0; s < body.sweeps.length; s++) {
          const sweepConfig = body.sweeps[s];
          const sweepId = `sweep_${s}`;
          const scores: SweepResult['scores'] = [];

          for (let v = 0; v < sweepConfig.values.length; v++) {
            const sweepValue = sweepConfig.values[v];
            const sweepSeed = seed + s * 1000 + v;

            // Create modified graph with sweep value
            const modifiedGraph = JSON.parse(JSON.stringify(baseGraph));

            // Apply sweep value to node or edge
            if (sweepConfig.parameter === 'value') {
              const node = modifiedGraph.nodes.find((n: any) => n.id === sweepConfig.node_id);
              if (node) {
                node.value = sweepValue;
              }
            } else if (sweepConfig.parameter === 'belief') {
              const edge = modifiedGraph.edges.find(
                (e: any) => e.from === sweepConfig.node_id || e.to === sweepConfig.node_id
              );
              if (edge) {
                edge.belief = sweepValue;
              }
            } else if (sweepConfig.parameter === 'weight') {
              const edge = modifiedGraph.edges.find(
                (e: any) => e.from === sweepConfig.node_id || e.to === sweepConfig.node_id
              );
              if (edge) {
                edge.weight = sweepValue;
              }
            }

            // Run inference for each option
            const optionScores: Array<{ option_id: string; score: number }> = [];

            for (let i = 0; i < optionNodes.length; i++) {
              const optionNode = optionNodes[i];
              const optionSeed = sweepSeed + i + 1;

              try {
                const result = await inferenceEngine.run(modifiedGraph, {
                  seed: optionSeed,
                  k_samples: DEFAULT_K_SAMPLES,
                  outcome_node: outcomeNode,
                  baseline_value: 100,
                  adaptiveK: false, // Faster for sweeps
                });

                optionScores.push({
                  option_id: optionNode.id,
                  score: Math.round(result.most_likely.outcome * 1000) / 1000,
                });
                totalEvaluations++;
              } catch (err: any) {
                req.log.warn({
                  evt: 'threshold_inference_error',
                  sweep_id: sweepId,
                  value: sweepValue,
                  option_id: optionNode.id,
                  error: err.message,
                });
              }
            }

            scores.push({
              value: sweepValue,
              option_scores: optionScores,
            });
          }

          localSweepResults.push({
            sweep_id: sweepId,
            node_id: sweepConfig.node_id,
            parameter: sweepConfig.parameter,
            scores,
          });
        }

        inferenceMs = Date.now() - inferenceStart;
        sweepResults = localSweepResults;
        analysis = computeLocalThresholds(sweepResults);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'threshold_analysis',
        id: requestId,
        sweeps_count: body.sweeps.length,
        total_evaluations: totalEvaluations,
        thresholds_found: analysis.thresholds.length,
        provenance,
        inference_ms: inferenceMs,
        isl_ms: islMs,
        duration_ms: duration,
      });

      const response: ThresholdResponse = {
        schema: 'thresholds.v1',
        analysis,
        sweep_results: sweepResults,
        provenance,
        model_card: {
          seed,
          nodes: baseGraph.nodes.length,
          edges: baseGraph.edges.length,
          sweeps_count: body.sweeps.length,
          total_evaluations: totalEvaluations,
        },
        timing: {
          inference_ms: inferenceMs,
          ...(islMs !== undefined && { isl_ms: islMs }),
          total_ms: duration,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
