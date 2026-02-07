/**
 * CEE Proxy Endpoints
 *
 * Proxies requests to CEE /assist/v1/* endpoints.
 * These endpoints allow the UI to bypass Netlify's ~50s Edge Function timeout
 * by routing through PLoT which has longer timeouts configured.
 *
 * Authentication: CEE_API_KEY is injected server-side, never exposed to client.
 *
 * Endpoints:
 * - POST /v1/cee/graph-readiness -> /assist/v1/graph-readiness (30s timeout)
 * - POST /v1/cee/bias-check -> /assist/v1/bias-check (60s timeout)
 * - POST /v1/cee/sensitivity-coach -> /assist/v1/sensitivity-coach (60s timeout)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import {
  CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS,
  CEE_PROXY_BIAS_CHECK_TIMEOUT_MS,
  CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS,
} from '../../config/timeouts.js';

// Timeout configurations per endpoint — sourced from central config
const TIMEOUTS = {
  'graph-readiness': CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS,
  'bias-check': CEE_PROXY_BIAS_CHECK_TIMEOUT_MS,
  'sensitivity-coach': CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS,
};

type CeeEndpoint = keyof typeof TIMEOUTS;

interface CeeProxyError {
  error: string;
  request_id?: string;
  details?: unknown;
}

interface CeeProxyResult {
  data: unknown;
  status: number;
  contentType: string;
  error?: CeeProxyError;
  latencyMs: number;
}

/**
 * Generic CEE proxy function
 */
async function callCeeEndpoint(
  endpoint: CeeEndpoint,
  body: unknown,
  queryString: string,
  incomingPath: string,
  requestId: string,
  correlationId: string,
  logger?: any
): Promise<CeeProxyResult> {
  const startMs = Date.now();
  const baseUrl = process.env.CEE_BASE_URL?.trim();
  const apiKey = process.env.CEE_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    return {
      data: null,
      status: 503,
      contentType: 'application/json',
      error: {
        error: 'CEE_BASE_URL or CEE_API_KEY not configured',
        request_id: requestId,
      },
      latencyMs: Date.now() - startMs,
    };
  }

  // Build URL with query string preserved
  const urlBase = `${baseUrl.replace(/\/$/, '')}/assist/v1/${endpoint}`;
  const url = queryString ? `${urlBase}?${queryString}` : urlBase;

  const timeoutMs = TIMEOUTS[endpoint];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Parse query params for logging
  const queryParams = new URLSearchParams(queryString);
  const schemaRequested = queryParams.get('schema') || 'none';

  try {
    // Log at request ingress
    logger?.info({
      event: 'CEE_PROXY_REQUEST',
      endpoint,
      request_id: requestId,
      correlation_id: correlationId,
      incoming_path: incomingPath,
      schema_requested: schemaRequested,
      upstream_url: url,  // Full URL including query string
      cee_host: baseUrl ? new URL(baseUrl).host : 'unknown',
      timeout_ms: timeoutMs,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Olumi-Assist-Key': apiKey,
        'X-Request-Id': requestId,
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;

    // Get response as text first (don't assume JSON)
    const responseText = await res.text();
    const responseContentType = res.headers.get('content-type') || 'application/json';

    // Try to parse as JSON if content type suggests it
    let data: unknown = responseText;
    let parsedData: Record<string, any> | null = null;
    if (responseContentType.startsWith('application/json') && responseText) {
      try {
        parsedData = JSON.parse(responseText);
        data = parsedData;
      } catch {
        // JSON parse failed — keep as text
      }
    }

    // Log at response egress (after parsing so we can include schema/model)
    logger?.info({
      event: 'CEE_PROXY_RESPONSE',
      endpoint,
      status: res.status,
      request_id: requestId,
      duration_ms: latencyMs,
      schema_served: parsedData?.schema_version || parsedData?.graph?.version,
      model_used: parsedData?.trace?.engine?.model,
    });

    // Handle error responses
    if (!res.ok) {
      logger?.warn({
        event: 'CEE_PROXY_ERROR',
        endpoint,
        status: res.status,
        request_id: requestId,
        duration_ms: latencyMs,
      });

      return {
        data,
        status: res.status,
        contentType: responseContentType,
        error: {
          error: `CEE returned status ${res.status}`,
          request_id: requestId,
          details: data,
        },
        latencyMs,
      };
    }

    return {
      data,
      status: res.status,
      contentType: responseContentType,
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startMs;

    const isTimeout = err.name === 'AbortError';

    logger?.warn({
      event: 'CEE_PROXY_FETCH_ERROR',
      endpoint,
      request_id: requestId,
      error: err.message,
      timeout: isTimeout,
      duration_ms: latencyMs,
    });

    if (isTimeout) {
      return {
        data: null,
        status: 504,
        contentType: 'application/json',
        error: {
          error: 'CEE request timeout',
          request_id: requestId,
        },
        latencyMs,
      };
    }

    return {
      data: null,
      status: 502,
      contentType: 'application/json',
      error: {
        error: 'CEE service unavailable',
        request_id: requestId,
        details: err.message,
      },
      latencyMs,
    };
  }
}

/**
 * Create a CEE proxy route handler
 */
function createCeeProxyHandler(endpoint: CeeEndpoint) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    const correlationId = (req.headers['x-correlation-id'] as string) || requestId;

    // Validate body exists
    if (!req.body || typeof req.body !== 'object' || Object.keys(req.body as object).length === 0) {
      return reply.code(400).send({
        error: 'Request body required',
        request_id: requestId,
      });
    }

    // Extract query string from URL (critical for ?schema=v3)
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';

    // Call CEE
    const result = await callCeeEndpoint(
      endpoint,
      req.body,
      queryString,
      req.url,  // Pass incoming path for logging
      requestId,
      correlationId,
      req.log
    );

    // Add trace headers
    reply.header('X-Request-Id', requestId);
    reply.header('X-CEE-Latency-Ms', String(result.latencyMs));

    // Set content type from CEE response
    reply.header('Content-Type', result.contentType);

    // Return response
    if (result.error) {
      return reply.code(result.status).send(result.error);
    }

    return reply.code(result.status).send(result.data);
  };
}

export async function registerCeeProxyRoutes(app: FastifyInstance) {
  // POST /v1/cee/graph-readiness
  app.post('/v1/cee/graph-readiness', createCeeProxyHandler('graph-readiness'));
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/graph-readiness',
    timeout_ms: TIMEOUTS['graph-readiness'],
  });

  // POST /v1/cee/bias-check
  app.post('/v1/cee/bias-check', createCeeProxyHandler('bias-check'));
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/bias-check',
    timeout_ms: TIMEOUTS['bias-check'],
  });

  // POST /v1/cee/sensitivity-coach
  app.post('/v1/cee/sensitivity-coach', createCeeProxyHandler('sensitivity-coach'));
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/sensitivity-coach',
    timeout_ms: TIMEOUTS['sensitivity-coach'],
  });
}
