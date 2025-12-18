/**
 * POST /v1/analysis/thresholds - Threshold Identification Proxy
 *
 * Runs inference at each parameter value in sweep configuration,
 * then forwards computed scores to ISL /api/v1/analysis/thresholds.
 *
 * Phase 2 Week 2: ISL integration
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
  SweepResult,
  ThresholdPoint,
  SensitivityRanking,
  ProxyError,
} from './types/proxy.types.js';

const MAX_NODES = 50;
const MAX_EDGES = 200;
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

      // Run sweeps
      const inferenceEngine = getInferenceEngine('model_based');
      const sweepResults: SweepResult[] = [];
      let totalEvaluations = 0;

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

        sweepResults.push({
          sweep_id: sweepId,
          node_id: sweepConfig.node_id,
          parameter: sweepConfig.parameter,
          scores,
        });
      }

      const inferenceEnd = Date.now();

      // Call ISL if enabled
      let analysis: IslThresholdResponse | null = null;
      let islError: ProxyError | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';
      let islMs: number | undefined;

      const islEnabled = isFlagOn(process.env.ISL_THRESHOLDS_ENABLE ?? process.env.ISL_ENABLE);

      if (islEnabled) {
        req.log.info({
          evt: 'thresholds_isl_call',
          id: requestId,
          sweeps_count: sweepResults.length,
          total_evaluations: totalEvaluations,
        });

        const islResult = await islService.callAnalysisEndpoint<IslThresholdResponse>(
          '/api/v1/analysis/thresholds',
          { plot_request_id: requestId, sweep_results: sweepResults },
          requestId
        );

        analysis = islResult.data;
        islError = islResult.error;
        islMs = islResult.latency_ms;

        if (analysis) {
          provenance = 'isl';
        }
      }

      // Use local fallback if ISL unavailable or disabled
      if (!analysis) {
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
        inference_ms: inferenceEnd - start,
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
          inference_ms: inferenceEnd - start,
          ...(islMs !== undefined && { isl_ms: islMs }),
          total_ms: duration,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
