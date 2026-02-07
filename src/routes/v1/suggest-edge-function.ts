/**
 * POST /v1/suggest/edge-function - Edge Function Suggestion Proxy
 *
 * Proxies edge function suggestions to CEE /assist/v1/suggest-edge-function.
 * Enriches request with node context from graph if provided.
 *
 * Phase 2: Non-linear edge functions - CEE integration
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { isFlagOn } from '../../cee/codes.js';
import type {
  EdgeFunctionSuggestionRequest,
  EdgeFunctionSuggestionResponse,
  CeeEdgeFunctionSuggestionResponse,
  EdgeNodeContext,
  ProxyError,
} from './types/proxy.types.js';
import type { NodeKind } from '../../trust/types.js';

import { CEE_TIMEOUT_MS } from '../../config/timeouts.js';

/**
 * Call CEE /assist/v1/suggest-edge-function endpoint
 */
async function callCeeSuggestEdgeFunction(
  body: {
    plot_request_id: string;
    edge_id: string;
    source_node: EdgeNodeContext;
    target_node: EdgeNodeContext;
    relationship_description?: string;
  },
  logger?: any
): Promise<{ suggestion: CeeEdgeFunctionSuggestionResponse | null; error?: ProxyError }> {
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      suggestion: null,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
    };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/assist/v1/suggest-edge-function`;
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
        evt: 'cee_suggest_edge_function_error',
        status: res.status,
        plot_request_id: body.plot_request_id,
      });

      return {
        suggestion: null,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500,
        },
      };
    }

    const data = await res.json();
    return { suggestion: data as CeeEdgeFunctionSuggestionResponse };
  } catch (err: any) {
    clearTimeout(timeoutId);

    const isTimeout = err.name === 'AbortError';
    logger?.warn({
      evt: 'cee_suggest_edge_function_fetch_error',
      error: err.message,
      timeout: isTimeout,
      plot_request_id: body.plot_request_id,
    });

    return {
      suggestion: null,
      error: {
        code: isTimeout ? 'CEE_TIMEOUT' : 'CEE_FETCH_ERROR',
        message: err.message || 'Failed to fetch from CEE',
        retryable: true,
      },
    };
  }
}

/**
 * Generate fallback edge function suggestion when CEE is unavailable
 */
function generateFallbackSuggestion(
  sourceNode: EdgeNodeContext,
  targetNode: EdgeNodeContext
): CeeEdgeFunctionSuggestionResponse {
  return {
    suggested_function: 'linear',
    suggested_params: {},
    reasoning: 'Default linear relationship (CEE unavailable)',
    confidence: 'low',
  };
}

/**
 * Enrich node context from graph if available
 */
function enrichNodeFromGraph(
  node: EdgeNodeContext,
  graphNodes?: Array<{ id: string; label?: string; kind?: NodeKind; value?: number }>
): EdgeNodeContext {
  if (!graphNodes) {
    return node;
  }

  const graphNode = graphNodes.find((n) => n.id === node.id);
  if (!graphNode) {
    return node;
  }

  return {
    id: node.id,
    label: node.label || graphNode.label || node.id,
    kind: node.kind || graphNode.kind,
  };
}

export async function registerSuggestEdgeFunctionRoute(app: FastifyInstance) {
  app.post(
    '/v1/suggest/edge-function',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as EdgeFunctionSuggestionRequest;
      const requestId = String(req.id);

      // Validate edge_id
      if (!body.edge_id || typeof body.edge_id !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'edge_id is required',
          fields: { field: 'edge_id' },
        });
      }

      // Validate source_node
      if (!body.source_node?.id || typeof body.source_node.id !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'source_node.id is required',
          fields: { field: 'source_node.id' },
        });
      }

      // Validate target_node
      if (!body.target_node?.id || typeof body.target_node.id !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'target_node.id is required',
          fields: { field: 'target_node.id' },
        });
      }

      // Enrich node context from graph if provided
      const sourceNode = enrichNodeFromGraph(body.source_node, body.graph?.nodes);
      const targetNode = enrichNodeFromGraph(body.target_node, body.graph?.nodes);

      // Call CEE if enabled
      let suggestion: CeeEdgeFunctionSuggestionResponse | null = null;
      let ceeError: ProxyError | undefined;
      let provenance: 'cee' | 'plot_fallback' = 'plot_fallback';

      const ceeEnabled = isFlagOn(process.env.CEE_EDGE_FUNCTION_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED);

      if (ceeEnabled) {
        req.log.info({
          evt: 'suggest_edge_function_cee_call',
          id: requestId,
          edge_id: body.edge_id,
        });

        const ceeResult = await callCeeSuggestEdgeFunction(
          {
            plot_request_id: requestId,
            edge_id: body.edge_id,
            source_node: sourceNode,
            target_node: targetNode,
            relationship_description: body.relationship_description,
          },
          req.log
        );

        suggestion = ceeResult.suggestion;
        ceeError = ceeResult.error;

        if (suggestion) {
          provenance = 'cee';
        }
      }

      // Use fallback if CEE unavailable or disabled
      if (!suggestion) {
        suggestion = generateFallbackSuggestion(sourceNode, targetNode);
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'suggest_edge_function',
        id: requestId,
        edge_id: body.edge_id,
        suggested_function: suggestion.suggested_function,
        provenance,
        duration_ms: duration,
      });

      const response: EdgeFunctionSuggestionResponse = {
        schema: 'edge_function_suggestion.v1',
        suggestion,
        edge_context: {
          edge_id: body.edge_id,
          source_node: sourceNode,
          target_node: targetNode,
        },
        provenance,
        ...(ceeError && { cee_error: ceeError }),
      };

      return reply.code(200).send(response);
    }
  );
}
