/**
 * POST /v1/analysis/risk-adjust - Risk Adjustment Proxy
 *
 * Runs inference per option to get p10/p50/p90, then forwards to
 * ISL /api/v1/analysis/risk-adjust with risk_coefficient and risk_type.
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
import type {
  RiskAdjustRequest,
  RiskAdjustResponse,
  IslRiskAdjustResponse,
  AdjustedOptionScore,
  ProxyError,
} from './types/proxy.types.js';

const MAX_NODES = 50;
const MAX_EDGES = 200;
const DEFAULT_K_SAMPLES = 32;
const ISL_TIMEOUT_MS = Number(process.env.ISL_TIMEOUT_MS || 10_000);

/**
 * Call ISL /api/v1/analysis/risk-adjust endpoint
 */
async function callIslRiskAdjust(
  body: {
    plot_request_id: string;
    option_scores: Array<{
      option_id: string;
      label: string;
      distribution: { p10: number; p50: number; p90: number };
    }>;
    risk_coefficient: number;
    risk_type: string;
  },
  logger?: any
): Promise<{ analysis: IslRiskAdjustResponse | null; error?: ProxyError }> {
  const baseUrl = process.env.ISL_BASE_URL?.trim();
  const apiKey = process.env.ISL_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      analysis: null,
      error: {
        code: 'ISL_CONFIG_MISSING',
        message: 'ISL_BASE_URL or ISL_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/api/v1/analysis/risk-adjust`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ISL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': body.plot_request_id,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger?.warn({
        evt: 'isl_risk_adjust_error',
        status: res.status,
        plot_request_id: body.plot_request_id,
      });

      return {
        analysis: null,
        error: {
          code: `ISL_HTTP_${res.status}`,
          message: `ISL returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { analysis: data as IslRiskAdjustResponse };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'isl_risk_adjust_fetch_error',
      error: err.message,
      timeout: isTimeout,
      plot_request_id: body.plot_request_id,
    });

    return {
      analysis: null,
      error: {
        code: isTimeout ? 'ISL_TIMEOUT' : 'ISL_FETCH_ERROR',
        message: err.message || 'Failed to fetch from ISL',
        retryable: true,
      },
    };
  }
}

/**
 * Apply risk adjustment utility function
 * For risk_coefficient < 0: risk averse (penalizes variance)
 * For risk_coefficient = 0: risk neutral (uses expected value)
 * For risk_coefficient > 0: risk seeking (rewards variance)
 */
function applyRiskAdjustment(
  p10: number,
  p50: number,
  p90: number,
  riskCoefficient: number,
  riskType: string
): number {
  const variance = ((p90 - p10) / 2) ** 2;
  const expectedValue = p50;

  if (riskType === 'exponential') {
    // Exponential utility: U = -exp(-r * x)
    // Approximate with mean-variance: E[U] ≈ mean - (r/2) * variance
    return expectedValue - (riskCoefficient / 2) * variance;
  } else if (riskType === 'power') {
    // Power utility approximation
    // For r < 0: more concave (risk averse)
    // For r > 0: less concave (risk seeking)
    const adjustedVariance = variance * Math.abs(riskCoefficient);
    return riskCoefficient < 0
      ? expectedValue - adjustedVariance
      : expectedValue + adjustedVariance * 0.5;
  } else {
    // Linear (default): simple mean-variance
    return expectedValue - riskCoefficient * Math.sqrt(variance);
  }
}

/**
 * Compute local risk adjustment when ISL is unavailable
 */
function computeLocalRiskAdjust(
  optionScores: Array<{
    option_id: string;
    label: string;
    distribution: { p10: number; p50: number; p90: number };
  }>,
  riskCoefficient: number,
  riskType: string
): IslRiskAdjustResponse {
  // Calculate original scores (using p50)
  const originalScores = optionScores.map((o, i) => ({
    option_id: o.option_id,
    label: o.label,
    original_score: o.distribution.p50,
    original_rank: 0,
    distribution: o.distribution,
  }));

  // Sort by original score descending and assign ranks
  originalScores.sort((a, b) => b.original_score - a.original_score);
  originalScores.forEach((o, i) => {
    o.original_rank = i + 1;
  });

  // Calculate adjusted scores
  const adjustedScores: AdjustedOptionScore[] = originalScores.map((o) => ({
    option_id: o.option_id,
    label: o.label,
    original_score: Math.round(o.original_score * 1000) / 1000,
    adjusted_score: Math.round(
      applyRiskAdjustment(
        o.distribution.p10,
        o.distribution.p50,
        o.distribution.p90,
        riskCoefficient,
        riskType
      ) * 1000
    ) / 1000,
    original_rank: o.original_rank,
    adjusted_rank: 0, // Will be assigned after sorting
    distribution: o.distribution,
  }));

  // Sort by adjusted score descending and assign ranks
  adjustedScores.sort((a, b) => b.adjusted_score - a.adjusted_score);
  adjustedScores.forEach((o, i) => {
    o.adjusted_rank = i + 1;
  });

  // Check if rankings changed
  const rankChanges = adjustedScores
    .map((o) => ({
      option_id: o.option_id,
      original_rank: o.original_rank,
      adjusted_rank: o.adjusted_rank,
      change: o.original_rank - o.adjusted_rank,
    }))
    .filter((c) => c.change !== 0);

  const rankingsChanged = rankChanges.length > 0;

  // Generate interpretation
  let interpretation = '';
  if (riskCoefficient < 0) {
    interpretation = rankingsChanged
      ? 'Risk-averse adjustment changed rankings, favoring options with lower variance.'
      : 'Risk-averse adjustment applied but rankings remained stable.';
  } else if (riskCoefficient > 0) {
    interpretation = rankingsChanged
      ? 'Risk-seeking adjustment changed rankings, favoring options with higher upside potential.'
      : 'Risk-seeking adjustment applied but rankings remained stable.';
  } else {
    interpretation = 'Risk-neutral (no adjustment applied).';
  }

  return {
    adjusted_scores: adjustedScores,
    rankings_changed: rankingsChanged,
    rank_changes: rankChanges,
    interpretation,
  };
}

export async function registerRiskAdjustRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/risk-adjust',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as RiskAdjustRequest;
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

      // Validate risk_coefficient
      if (body.risk_coefficient === undefined || typeof body.risk_coefficient !== 'number') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'risk_coefficient is required and must be a number',
          fields: { field: 'risk_coefficient' },
        });
      }

      // Normalize and apply edge type inference
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
      };

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

      if (optionNodes.length < 2) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'At least 2 option or action nodes required for risk adjustment',
          fields: { field: 'graph.nodes' },
        });
      }

      const riskType = body.risk_type ?? 'linear';

      // Run inference for each option
      const inferenceEngine = getInferenceEngine('model_based');
      const optionScores: Array<{
        option_id: string;
        label: string;
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

          optionScores.push({
            option_id: optionNode.id,
            label: optionNode.label || optionNode.id,
            distribution: {
              p10: Math.round(result.conservative.outcome * 1000) / 1000,
              p50: Math.round(result.most_likely.outcome * 1000) / 1000,
              p90: Math.round(result.optimistic.outcome * 1000) / 1000,
            },
          });
        } catch (err: any) {
          req.log.warn({
            evt: 'risk_adjust_inference_error',
            option_id: optionNode.id,
            error: err.message,
          });
        }
      }

      if (optionScores.length < 2) {
        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'Inference failed for too many options',
          fields: { code: 'INFERENCE_FAILED' },
        });
      }

      // Call ISL if enabled
      let analysis: IslRiskAdjustResponse | null = null;
      let islError: ProxyError | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';

      const islEnabled = isFlagOn(process.env.ISL_RISK_ADJUST_ENABLE ?? process.env.ISL_ENABLE);

      if (islEnabled) {
        req.log.info({
          evt: 'risk_adjust_isl_call',
          id: requestId,
          option_count: optionScores.length,
          risk_coefficient: body.risk_coefficient,
          risk_type: riskType,
        });

        const islResult = await callIslRiskAdjust(
          {
            plot_request_id: requestId,
            option_scores: optionScores,
            risk_coefficient: body.risk_coefficient,
            risk_type: riskType,
          },
          req.log
        );

        analysis = islResult.analysis;
        islError = islResult.error;

        if (analysis) {
          provenance = 'isl';
        }
      }

      // Use local fallback if ISL unavailable or disabled
      if (!analysis) {
        analysis = computeLocalRiskAdjust(optionScores, body.risk_coefficient, riskType);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'risk_adjust_analysis',
        id: requestId,
        option_count: optionScores.length,
        risk_coefficient: body.risk_coefficient,
        risk_type: riskType,
        rankings_changed: analysis.rankings_changed,
        provenance,
        duration_ms: duration,
      });

      const response: RiskAdjustResponse = {
        schema: 'risk_adjust.v1',
        analysis,
        risk_parameters: {
          risk_coefficient: body.risk_coefficient,
          risk_type: riskType,
        },
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          options_analyzed: optionScores.length,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
