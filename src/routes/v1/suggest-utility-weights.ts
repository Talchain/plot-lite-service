/**
 * POST /v1/suggest/utility-weights - Utility Weight Suggestions Proxy
 *
 * Runs inference to identify outcome nodes, then forwards to CEE
 * /assist/v1/suggest-utility-weights with graph context.
 *
 * Phase 2 Week 2: CEE routing architecture
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { normalizeGraph } from '../../util/normalize.js';
import { detectPrimaryOutcome } from '../../services/ranking/outcome-detector.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  UtilityWeightSuggestionsRequest,
  UtilityWeightSuggestionsResponse,
  CeeUtilityWeightSuggestionsResponse,
  OutcomeWeightSuggestion,
} from './types/proxy.types.js';
import type { NodeKind } from '../../trust/types.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * Call CEE /assist/v1/suggest-utility-weights endpoint
 */
async function callCeeSuggestWeights(
  body: {
    plot_request_id: string;
    outcome_nodes: Array<{ node_id: string; node_label: string; node_kind?: NodeKind }>;
    graph_summary: { nodes: number; edges: number };
    context?: { question?: string; notes?: string };
  },
  logger?: any
): Promise<{ suggestions: CeeUtilityWeightSuggestionsResponse | null; error?: { code: string; message: string; retryable: boolean } }> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      suggestions: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/suggest-utility-weights`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CEE_TIMEOUT_MS);

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
        evt: 'cee_suggest_weights_error',
        status: res.status,
        plot_request_id: body.plot_request_id,
      });

      return {
        suggestions: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { suggestions: data as CeeUtilityWeightSuggestionsResponse };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_suggest_weights_fetch_error',
      error: err.message,
      timeout: isTimeout,
      plot_request_id: body.plot_request_id,
    });

    return {
      suggestions: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Generate fallback weight suggestions when CEE is unavailable
 */
function generateFallbackSuggestions(
  outcomeNodes: Array<{ node_id: string; node_label: string }>
): CeeUtilityWeightSuggestionsResponse {
  // Equal weights for all outcome nodes
  const weight = outcomeNodes.length > 0 ? 1 / outcomeNodes.length : 0;

  const suggestions: OutcomeWeightSuggestion[] = outcomeNodes.map((node) => ({
    node_id: node.node_id,
    node_label: node.node_label,
    suggested_weight: Math.round(weight * 1000) / 1000,
    rationale: 'Equal weighting applied as fallback. Consider which outcomes are most important to your decision.',
  }));

  return {
    suggestions,
    confidence: 'low',
    follow_up_questions: [
      'Which outcome matters most to you?',
      'Are any outcomes more time-sensitive than others?',
      'Would you trade off one outcome for another? At what ratio?',
    ],
  };
}

export async function registerSuggestUtilityWeightsRoute(app: FastifyInstance) {
  app.post(
    '/v1/suggest/utility-weights',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as UtilityWeightSuggestionsRequest;
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

      // Detect outcome nodes
      const detection = detectPrimaryOutcome(graph);
      const outcomeNodeIds = detection.outcome_nodes;

      // Build outcome node context
      const outcomeNodes = outcomeNodeIds.map((nodeId) => {
        const node = graph.nodes.find((n: any) => n.id === nodeId);
        return {
          node_id: nodeId,
          node_label: node?.label || nodeId,
          node_kind: node?.kind as NodeKind | undefined,
        };
      });

      // Also include goal nodes as potential outcomes
      const goalNodes = graph.nodes
        .filter((n: any) => n.kind === 'goal')
        .map((n: any) => ({
          node_id: n.id,
          node_label: n.label || n.id,
          node_kind: 'goal' as NodeKind,
        }));

      // Combine and deduplicate
      const allOutcomeNodes = [...outcomeNodes];
      for (const goalNode of goalNodes) {
        if (!allOutcomeNodes.some((n) => n.node_id === goalNode.node_id)) {
          allOutcomeNodes.push(goalNode);
        }
      }

      if (allOutcomeNodes.length === 0) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'No outcome or goal nodes found in graph',
          fields: { field: 'graph.nodes' },
        });
      }

      // Call CEE if enabled
      let suggestions: CeeUtilityWeightSuggestionsResponse | null = null;
      let ceeError: { code: string; message: string; retryable: boolean } | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(process.env.CEE_UTILITY_WEIGHTS_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED);

      if (ceeEnabled) {
        req.log.info({
          evt: 'suggest_utility_weights_cee_call',
          id: requestId,
          outcome_count: allOutcomeNodes.length,
        });

        const ceeResult = await callCeeSuggestWeights(
          {
            plot_request_id: requestId,
            outcome_nodes: allOutcomeNodes,
            graph_summary: {
              nodes: graph.nodes.length,
              edges: graph.edges.length,
            },
            context: body.context,
          },
          req.log
        );

        suggestions = ceeResult.suggestions;
        ceeError = ceeResult.error;

        if (suggestions) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable or disabled
      if (!suggestions) {
        suggestions = generateFallbackSuggestions(
          allOutcomeNodes.map((n) => ({ node_id: n.node_id, node_label: n.node_label }))
        );
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'suggest_utility_weights',
        id: requestId,
        outcome_count: allOutcomeNodes.length,
        provenance,
        duration_ms: duration,
      });

      const response: UtilityWeightSuggestionsResponse = {
        schema: 'utility_weights.v1',
        suggestions,
        outcome_nodes: allOutcomeNodes.map((n) => ({
          node_id: n.node_id,
          node_label: n.node_label,
        })),
        provenance,
        model_card: {
          seed: body.seed ?? 4242,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
