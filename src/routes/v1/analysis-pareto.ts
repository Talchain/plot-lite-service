/**
 * POST /v1/analysis/pareto - Pareto Analysis Proxy
 *
 * Runs inference per option, normalizes scores to 0-1, then forwards to
 * ISL /api/v1/analysis/pareto for Pareto frontier detection.
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
  ParetoAnalysisRequest,
  ParetoAnalysisResponse,
  IslParetoResponse,
  OptionResult,
  ProxyError,
} from './types/proxy.types.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

const DEFAULT_K_SAMPLES = 32;

/**
 * Compute local Pareto frontier when ISL is unavailable.
 * Non-dominated options form the Pareto frontier.
 */
function computeLocalPareto(options: OptionResult[]): IslParetoResponse {
  const dominatedSet = new Set<string>();

  // Pairwise comparison for dominance
  for (let i = 0; i < options.length; i++) {
    for (let j = 0; j < options.length; j++) {
      if (i === j) continue;

      const a = options[i];
      const b = options[j];

      // a dominates b if a is better or equal on all metrics and strictly better on at least one
      const aDominatesB =
        a.distribution.p10 >= b.distribution.p10 &&
        a.distribution.p50 >= b.distribution.p50 &&
        a.distribution.p90 >= b.distribution.p90 &&
        (a.distribution.p10 > b.distribution.p10 ||
         a.distribution.p50 > b.distribution.p50 ||
         a.distribution.p90 > b.distribution.p90);

      if (aDominatesB) {
        dominatedSet.add(b.option_id);
      }
    }
  }

  const frontier = options
    .filter((o) => !dominatedSet.has(o.option_id))
    .map((o) => o.option_id);

  const dominated = Array.from(dominatedSet);

  // Generate trade-off descriptions for frontier options
  const tradeOffs: Array<{ option_a: string; option_b: string; description: string }> = [];
  const frontierOptions = options.filter((o) => frontier.includes(o.option_id));

  for (let i = 0; i < frontierOptions.length; i++) {
    for (let j = i + 1; j < frontierOptions.length; j++) {
      const a = frontierOptions[i];
      const b = frontierOptions[j];

      let description = '';
      if (a.distribution.p50 > b.distribution.p50) {
        description = `${a.label} has higher expected value but ${b.label} may have other advantages`;
      } else if (b.distribution.p50 > a.distribution.p50) {
        description = `${b.label} has higher expected value but ${a.label} may have other advantages`;
      } else {
        description = `${a.label} and ${b.label} have similar expected values with different risk profiles`;
      }

      tradeOffs.push({
        option_a: a.option_id,
        option_b: b.option_id,
        description,
      });
    }
  }

  return {
    frontier,
    dominated,
    frontier_size: frontier.length,
    trade_offs: tradeOffs.length > 0 ? tradeOffs : undefined,
  };
}

/**
 * Normalize a value to 0-1 range based on min/max
 */
function normalizeScore(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

export async function registerParetoAnalysisRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/pareto',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as ParetoAnalysisRequest;
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
          message: 'At least 2 option or action nodes required for Pareto analysis',
          fields: { field: 'graph.nodes' },
        });
      }

      // Run inference for each option
      const inferenceEngine = getInferenceEngine('model_based');
      const optionResults: OptionResult[] = [];

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

          optionResults.push({
            option_id: optionNode.id,
            label: optionNode.label || optionNode.id,
            score: 0, // Will be normalized later
            distribution: {
              p10: Math.round(result.conservative.outcome * 1000) / 1000,
              p50: Math.round(result.most_likely.outcome * 1000) / 1000,
              p90: Math.round(result.optimistic.outcome * 1000) / 1000,
            },
          });
        } catch (err: any) {
          req.log.warn({
            evt: 'pareto_inference_error',
            option_id: optionNode.id,
            error: err.message,
          });
        }
      }

      if (optionResults.length < 2) {
        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'Inference failed for too many options',
          fields: { code: 'INFERENCE_FAILED' },
        });
      }

      // Normalize scores to 0-1 range
      const p50Values = optionResults.map((o) => o.distribution.p50);
      const minP50 = Math.min(...p50Values);
      const maxP50 = Math.max(...p50Values);

      for (const option of optionResults) {
        option.score = Math.round(normalizeScore(option.distribution.p50, minP50, maxP50) * 1000) / 1000;
      }

      // Sort by score descending
      optionResults.sort((a, b) => b.score - a.score);

      const inferenceEnd = Date.now();

      // Call ISL if enabled
      let analysis: IslParetoResponse | null = null;
      let islError: ProxyError | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';
      let islMs: number | undefined;

      const islEnabled = isFlagOn(process.env.ISL_PARETO_ENABLE ?? process.env.ISL_ENABLE);

      if (islEnabled) {
        req.log.info({
          evt: 'pareto_isl_call',
          id: requestId,
          option_count: optionResults.length,
        });

        const islResult = await islService.callAnalysisEndpoint<IslParetoResponse>(
          '/api/v1/analysis/pareto',
          { plot_request_id: requestId, options: optionResults },
          requestId
        );
        islMs = islResult.latency_ms;

        analysis = islResult.data;
        islError = islResult.error;

        if (analysis) {
          provenance = 'isl';
        }
      }

      // Use local fallback if ISL unavailable or disabled
      if (!analysis) {
        analysis = computeLocalPareto(optionResults);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'pareto_analysis',
        id: requestId,
        option_count: optionResults.length,
        frontier_size: analysis.frontier_size,
        dominated_count: analysis.dominated.length,
        provenance,
        inference_ms: inferenceEnd - start,
        isl_ms: islMs,
        duration_ms: duration,
      });

      const response: ParetoAnalysisResponse = {
        schema: 'pareto.v1',
        analysis,
        option_results: optionResults,
        provenance,
        model_card: {
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
          options_analyzed: optionResults.length,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
