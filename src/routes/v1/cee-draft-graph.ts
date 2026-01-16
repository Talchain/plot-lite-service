/**
 * POST /v1/cee/draft-graph - CEE Draft Graph Proxy
 *
 * Proxies draft-graph requests to CEE /assist/v1/draft-graph.
 * This endpoint allows the UI to bypass Netlify's ~50s Edge Function timeout
 * by routing through PLoT which has a 120s timeout configured.
 *
 * Authentication: CEE_API_KEY is injected server-side, never exposed to client.
 * Timeout: 120000ms (CEE typically takes 45-70s, plus buffer for network latency)
 *
 * @see https://github.com/olumi/plot-lite-service/docs/cee-proxy.md
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';

// CEE timeout: 120s to accommodate CEE's 45-70s processing time + network buffer
// This is intentionally longer than the default CEE_TIMEOUT_MS (60s) used for
// orchestrated calls, since this is a direct proxy where we want to wait for
// the full CEE response.
const CEE_DRAFT_GRAPH_TIMEOUT_MS = Number(process.env.CEE_DRAFT_GRAPH_TIMEOUT_MS || 120_000);

interface CeeDraftGraphError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

interface CeeDraftGraphResult {
  data: unknown;
  status: number;
  error?: CeeDraftGraphError;
  trace?: {
    request_id: string;
    latency_ms: number;
  };
}

/**
 * Call CEE /assist/v1/draft-graph endpoint
 *
 * @param body - Request body to forward to CEE
 * @param queryString - Query string to append (e.g., "schema=v3")
 * @param incomingPath - Original incoming request path for logging
 * @param requestId - Request ID for tracing
 * @param correlationId - Optional correlation ID for distributed tracing
 * @param logger - Fastify logger
 */
async function callCeeDraftGraph(
  body: unknown,
  queryString: string,
  incomingPath: string,
  requestId: string,
  correlationId: string | undefined,
  logger?: any
): Promise<CeeDraftGraphResult> {
  const startMs = Date.now();
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      data: null,
      status: 503,
      error: {
        code: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
      },
      trace: { request_id: requestId, latency_ms: Date.now() - startMs },
    };
  }

  // Build URL with query string
  const urlBase = `${baseUrl.replace(/\/$/, '')}/assist/v1/draft-graph`;
  const url = queryString ? `${urlBase}?${queryString}` : urlBase;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CEE_DRAFT_GRAPH_TIMEOUT_MS);

  // Parse query params for logging
  const queryParams = new URLSearchParams(queryString);
  const schemaRequested = queryParams.get('schema') || 'none';

  try {
    logger?.info({
      evt: 'cee_draft_graph_call',
      request_id: requestId,
      correlation_id: correlationId,
      incoming_path: incomingPath,
      schema_requested: schemaRequested,
      upstream_url: url,  // Full URL including query string
      cee_host: baseUrl ? new URL(baseUrl).host : 'unknown',
      timeout_ms: CEE_DRAFT_GRAPH_TIMEOUT_MS,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Olumi-Assist-Key': apiKey,
        'X-Request-Id': requestId,
        ...(correlationId && { 'X-Correlation-Id': correlationId }),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;

    // Forward CEE error responses as-is
    if (!res.ok) {
      let errorBody: unknown = null;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = await res.text().catch(() => null);
      }

      logger?.warn({
        evt: 'cee_draft_graph_error',
        request_id: requestId,
        status: res.status,
        latency_ms: latencyMs,
      });

      return {
        data: errorBody,
        status: res.status,
        error: {
          code: `CEE_HTTP_${res.status}`,
          message: `CEE returned status ${res.status}`,
          retryable: res.status >= 500 || res.status === 429,
          details: errorBody,
        },
        trace: { request_id: requestId, latency_ms: latencyMs },
      };
    }

    // Parse successful response
    const data = await res.json() as Record<string, any>;

    // Log response metadata with schema/model info (data already parsed)
    logger?.info({
      evt: 'cee_draft_graph_response',
      request_id: requestId,
      status: res.status,
      latency_ms: latencyMs,
      schema_served: data?.schema_version || data?.graph?.version,
      model_used: data?.trace?.engine?.model,
    });

    return {
      data,
      status: res.status,
      trace: { request_id: requestId, latency_ms: latencyMs },
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;

    const isTimeout = err.name === 'AbortError';
    const errorCode = isTimeout ? 'CEE_TIMEOUT' : 'CEE_NETWORK_ERROR';
    const statusCode = isTimeout ? 504 : 502;

    logger?.warn({
      evt: 'cee_draft_graph_fetch_error',
      request_id: requestId,
      error: err.message,
      error_code: errorCode,
      timeout: isTimeout,
      latency_ms: latencyMs,
    });

    return {
      data: null,
      status: statusCode,
      error: {
        code: errorCode,
        message: isTimeout
          ? `CEE request timed out after ${CEE_DRAFT_GRAPH_TIMEOUT_MS}ms`
          : err.message || 'Failed to connect to CEE',
        retryable: true,
      },
      trace: { request_id: requestId, latency_ms: latencyMs },
    };
  }
}

export async function registerCeeDraftGraphRoute(app: FastifyInstance) {
  /**
   * POST /v1/cee/draft-graph
   *
   * Proxies requests to CEE /assist/v1/draft-graph
   * Query parameters are forwarded (e.g., ?schema=v3)
   * Request body is forwarded as-is
   * CEE API key is injected server-side
   */
  app.post(
    '/v1/cee/draft-graph',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const requestId = String(req.id);
      const correlationId = (req.headers['x-correlation-id'] || req.headers['X-Correlation-Id']) as string | undefined;

      // Extract query string from URL
      const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';

      // Validate body exists
      if (!req.body || typeof req.body !== 'object') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'Request body is required',
          fields: { field: 'body' },
        });
      }

      // Call CEE
      const result = await callCeeDraftGraph(
        req.body,
        queryString,
        req.url,  // Pass incoming path for logging
        requestId,
        correlationId,
        req.log
      );

      // Add trace headers
      reply.header('X-Request-Id', requestId);
      if (result.trace) {
        reply.header('X-CEE-Latency-Ms', String(result.trace.latency_ms));
      }

      // Return error response with appropriate status code
      if (result.error) {
        const errorResponse: {
          error: CeeDraftGraphError;
          trace?: { request_id: string; latency_ms: number };
          cee_response?: unknown;
        } = {
          error: result.error,
          trace: result.trace,
        };
        // Include original CEE response data if present (for debugging)
        if (result.data) {
          errorResponse.cee_response = result.data;
        }
        return reply.code(result.status).send(errorResponse);
      }

      // Return successful response as-is from CEE
      return reply.code(result.status).send(result.data);
    }
  );

  // Log route registration
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/draft-graph',
    timeout_ms: CEE_DRAFT_GRAPH_TIMEOUT_MS,
  });
}
