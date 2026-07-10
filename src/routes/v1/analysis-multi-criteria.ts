/**
 * POST /v1/analysis/multi-criteria - Multi-Criteria Orchestration
 *
 * Runs inference N times (once per criterion), collects and normalizes scores,
 * then forwards to ISL /api/v1/aggregation/multi-criteria.
 *
 * Phase 2 Week 2: ISL integration
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { isFlagOn } from '../../cee/codes.js';
import { islService, toPublicIslError } from '../../integrations/isl/index.js';
import type {
  MultiCriteriaRequest,
  MultiCriteriaResponse,
  IslMultiCriteriaResponse,
  CriterionResult,
  AggregatedRanking,
  TradeOff,
  ProxyError,
} from './types/proxy.types.js';
import { MAX_NODES, MAX_EDGES, MAX_OPTIONS } from '../../constants/limits.js';

const MAX_CRITERIA = MAX_OPTIONS;
const DEFAULT_K_SAMPLES = 32;

/**
 * Compute local weighted aggregation when ISL is unavailable
 */
function computeLocalAggregation(
  criterionResults: CriterionResult[],
  criteriaWeights: Record<string, number>,
  optionNodes: Array<{ id: string; label: string }>,
  aggregationMethod: string,
  percentile: 'p10' | 'p50' | 'p90'
): IslMultiCriteriaResponse {
  // Build option scores map
  const optionScores: Map<string, { scores: Record<string, number>; label: string }> = new Map();

  for (const option of optionNodes) {
    optionScores.set(option.id, { scores: {}, label: option.label });
  }

  // Collect scores from each criterion
  for (const result of criterionResults) {
    if (!result.success) continue;

    for (const optionScore of result.option_scores) {
      const existing = optionScores.get(optionScore.option_id);
      if (existing) {
        existing.scores[result.criterion_id] = optionScore.distribution[percentile];
      }
    }
  }

  // Normalize scores within each criterion to 0-1
  const successfulCriteria = criterionResults.filter((r) => r.success);
  for (const criterion of successfulCriteria) {
    const scores = criterion.option_scores.map((o) => o.distribution[percentile]);
    const min = Math.min(...scores);
    const max = Math.max(...scores);

    if (max > min) {
      for (const [optionId, data] of optionScores) {
        if (data.scores[criterion.criterion_id] !== undefined) {
          data.scores[criterion.criterion_id] = (data.scores[criterion.criterion_id] - min) / (max - min);
        }
      }
    }
  }

  // Compute aggregated scores
  const aggregatedRankings: AggregatedRanking[] = [];

  for (const [optionId, data] of optionScores) {
    let aggregatedScore = 0;

    if (aggregationMethod === 'weighted_product') {
      // Weighted geometric mean
      let product = 1;
      let totalWeight = 0;
      for (const [criterionId, score] of Object.entries(data.scores)) {
        const weight = criteriaWeights[criterionId] ?? 0;
        if (weight > 0 && score > 0) {
          product *= Math.pow(score, weight);
          totalWeight += weight;
        }
      }
      aggregatedScore = totalWeight > 0 ? product : 0;
    } else {
      // Default: weighted sum
      for (const [criterionId, score] of Object.entries(data.scores)) {
        const weight = criteriaWeights[criterionId] ?? 0;
        aggregatedScore += score * weight;
      }
    }

    aggregatedRankings.push({
      option_id: optionId,
      label: data.label,
      aggregated_score: Math.round(aggregatedScore * 1000) / 1000,
      rank: 0, // Will be assigned after sorting
      criterion_scores: data.scores,
    });
  }

  // Sort and assign ranks
  aggregatedRankings.sort((a, b) => b.aggregated_score - a.aggregated_score);
  aggregatedRankings.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Generate trade-offs between top options
  const tradeOffs: TradeOff[] = [];
  const topOptions = aggregatedRankings.slice(0, 3);

  for (let i = 0; i < topOptions.length; i++) {
    for (let j = i + 1; j < topOptions.length; j++) {
      const a = topOptions[i];
      const b = topOptions[j];

      const aBetterOn: string[] = [];
      const bBetterOn: string[] = [];

      for (const criterion of successfulCriteria) {
        const aScore = a.criterion_scores[criterion.criterion_id] ?? 0;
        const bScore = b.criterion_scores[criterion.criterion_id] ?? 0;

        if (aScore > bScore + 0.05) {
          aBetterOn.push(criterion.criterion_id);
        } else if (bScore > aScore + 0.05) {
          bBetterOn.push(criterion.criterion_id);
        }
      }

      if (aBetterOn.length > 0 || bBetterOn.length > 0) {
        tradeOffs.push({
          option_a: a.option_id,
          option_b: b.option_id,
          a_better_on: aBetterOn,
          b_better_on: bBetterOn,
          description: `${a.label} excels on ${aBetterOn.length} criteria, ${b.label} excels on ${bBetterOn.length} criteria`,
        });
      }
    }
  }

  // Determine confidence based on criterion success rate and score spread
  const successRate = successfulCriteria.length / criterionResults.length;
  const scoreSpread = aggregatedRankings.length > 1
    ? aggregatedRankings[0].aggregated_score - aggregatedRankings[aggregatedRankings.length - 1].aggregated_score
    : 0;

  let confidence: 'high' | 'medium' | 'low' = 'medium';
  if (successRate === 1 && scoreSpread > 0.3) {
    confidence = 'high';
  } else if (successRate < 0.5 || scoreSpread < 0.1) {
    confidence = 'low';
  }

  return {
    aggregated_rankings: aggregatedRankings,
    trade_offs: tradeOffs,
    aggregation_confidence: confidence,
    warnings: successRate < 1 ? [`${criterionResults.length - successfulCriteria.length} criteria failed to evaluate`] : undefined,
  };
}

export async function registerMultiCriteriaAnalysisRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/multi-criteria',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as MultiCriteriaRequest;
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

      // Validate criteria
      if (!body.criteria || !Array.isArray(body.criteria) || body.criteria.length === 0) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'criteria array required with at least one criterion',
          fields: { field: 'criteria' },
        });
      }

      if (body.criteria.length > MAX_CRITERIA) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Maximum ${MAX_CRITERIA} criteria allowed, got ${body.criteria.length}`,
          fields: { field: 'criteria' },
        });
      }

      // Validate weights sum to ~1.0
      const weightSum = body.criteria.reduce((sum, c) => sum + (c.weight ?? 0), 0);
      if (Math.abs(weightSum - 1.0) > 0.01) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Criteria weights must sum to 1.0 (got ${weightSum.toFixed(4)})`,
          fields: { field: 'criteria' },
        });
      }

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
      };

      // Find option nodes
      const optionNodes = graph.nodes
        .filter((n: any) => n.kind === 'option' || n.kind === 'action')
        .map((n: any) => ({ id: n.id, label: n.label || n.id }));

      if (optionNodes.length < 2) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'At least 2 option or action nodes required for multi-criteria analysis',
          fields: { field: 'graph.nodes' },
        });
      }

      const seed = body.seed ?? 4242;
      const aggregationMethod = body.aggregation_method ?? 'weighted_sum';
      const percentile = body.percentile ?? 'p50';

      // Run inference for each criterion
      const inferenceEngine = getInferenceEngine('model_based');
      const criterionResults: CriterionResult[] = [];

      for (let c = 0; c < body.criteria.length; c++) {
        const criterion = body.criteria[c];
        const criterionSeed = seed + (c * 1000);

        const optionScores: CriterionResult['option_scores'] = [];
        let success = true;
        let error: string | undefined;

        for (let i = 0; i < optionNodes.length; i++) {
          const option = optionNodes[i];
          const optionSeed = criterionSeed + i + 1;

          try {
            const result = await inferenceEngine.run(graph, {
              seed: optionSeed,
              k_samples: DEFAULT_K_SAMPLES,
              outcome_node: criterion.outcome_node,
              baseline_value: 100,
              adaptiveK: true,
            });

            optionScores.push({
              option_id: option.id,
              score: 0, // Will be normalized later
              distribution: {
                p10: Math.round(result.conservative.outcome * 1000) / 1000,
                p50: Math.round(result.most_likely.outcome * 1000) / 1000,
                p90: Math.round(result.optimistic.outcome * 1000) / 1000,
              },
            });
          } catch (err: any) {
            req.log.warn({
              evt: 'multi_criteria_inference_error',
              criterion_id: criterion.id,
              option_id: option.id,
              error: err.message,
            });
            success = false;
            error = err.message;
            break; // Skip remaining options for this criterion
          }
        }

        // Normalize scores within criterion
        if (success && optionScores.length > 0) {
          const p50Values = optionScores.map((o) => o.distribution.p50);
          const min = Math.min(...p50Values);
          const max = Math.max(...p50Values);

          if (max > min) {
            for (const option of optionScores) {
              option.score = Math.round(((option.distribution.p50 - min) / (max - min)) * 1000) / 1000;
            }
          } else {
            for (const option of optionScores) {
              option.score = 0.5;
            }
          }
        }

        criterionResults.push({
          criterion_id: criterion.id,
          option_scores: optionScores,
          success,
          ...(error && { error }),
        });
      }

      const inferenceEnd = Date.now();
      const criteriaSucceeded = criterionResults.filter((r) => r.success).length;
      const criteriaFailed = criterionResults.length - criteriaSucceeded;

      if (criteriaSucceeded === 0) {
        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'All criteria failed to evaluate',
          fields: { code: 'INFERENCE_FAILED' },
        });
      }

      // Build criteria weights map
      const criteriaWeights: Record<string, number> = {};
      for (const criterion of body.criteria) {
        criteriaWeights[criterion.id] = criterion.weight;
      }

      // Call ISL if enabled
      let aggregation: IslMultiCriteriaResponse | null = null;
      let islError: ProxyError | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';
      let islMs: number | undefined;

      const islEnabled = isFlagOn(process.env.ISL_MULTI_CRITERIA_ENABLE ?? process.env.ISL_ENABLE);

      if (islEnabled) {
        req.log.info({
          evt: 'multi_criteria_isl_call',
          id: requestId,
          criteria_count: criterionResults.length,
          options_count: optionNodes.length,
        });

        const islResult = await islService.callAnalysisEndpoint<IslMultiCriteriaResponse>(
          '/api/v1/aggregation/multi-criteria',
          {
            plot_request_id: requestId,
            criterion_results: criterionResults,
            criteria_weights: criteriaWeights,
            aggregation_method: aggregationMethod,
            percentile,
          },
          requestId
        );

        aggregation = islResult.data;
        islError = toPublicIslError(islResult.error);
        islMs = islResult.latency_ms;

        if (aggregation) {
          provenance = 'isl';
        }
      }

      // Use local fallback if ISL unavailable or disabled
      if (!aggregation) {
        aggregation = computeLocalAggregation(
          criterionResults,
          criteriaWeights,
          optionNodes,
          aggregationMethod,
          percentile
        );
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'multi_criteria_analysis',
        id: requestId,
        criteria_count: body.criteria.length,
        criteria_succeeded: criteriaSucceeded,
        criteria_failed: criteriaFailed,
        options_count: optionNodes.length,
        provenance,
        inference_ms: inferenceEnd - start,
        isl_ms: islMs,
        duration_ms: duration,
      });

      const response: MultiCriteriaResponse = {
        schema: 'multi_criteria.v1',
        aggregation,
        criterion_results: criterionResults,
        criteria_succeeded: criteriaSucceeded,
        criteria_failed: criteriaFailed,
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          options_analyzed: optionNodes.length,
          criteria_count: body.criteria.length,
          aggregation_method: aggregationMethod,
          percentile,
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
