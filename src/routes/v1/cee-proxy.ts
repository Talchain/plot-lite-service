/**
 * CEE Proxy Endpoints
 *
 * Proxies requests to CEE /assist/v1/* endpoints.
 * These endpoints allow the UI to bypass Netlify's ~50s Edge Function timeout
 * by routing through PLoT which has longer timeouts configured.
 *
 * Authentication: CEE_API_KEY is injected server-side, never exposed to client.
 *
 * Error handling (matches cee-draft-graph.ts passthrough pattern):
 *   - CEE JSON errors are forwarded as-is (status + body preserved)
 *   - Non-JSON CEE errors are wrapped in a BFF error envelope
 *   - Proxy timeout → UpstreamTimeoutError with timeoutPhase
 *   - Network error → 502 with details
 *   - Client disconnect → ClientDisconnectError
 *
 * Endpoints:
 * - POST /v1/cee/graph-readiness -> /assist/v1/graph-readiness (10s timeout)
 * - POST /v1/cee/sensitivity-coach -> /assist/v1/sensitivity-coach (60s timeout)
 * - POST /v1/cee/prompts/warm -> /assist/v1/prompts/warm (10s timeout)
 *
 * RETIRED: POST /v1/cee/bias-check (ROADMAP 2.632, S-1). It proxied the caller's real
 * graph straight to CEE /assist/v1/bias-check, which has no id-grounding gate and no
 * DSK cite-or-reject — so it was the ungrounded bias route, and it had ZERO non-test
 * callers in the estate. Retiring it also closes the "cheap path" that would have
 * satisfied the real-graph ruling's letter while breaking its reasoning: a
 * UI-originated bias check runs on the UI's canvas graph, not the persisted graph the
 * analysis engine consumes. The UI's now-orphaned `CEEClient.biasCheck` is retired
 * separately (2.632's UI half).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import {
  CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS,
  CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS,
  CEE_PROXY_PROMPTS_WARM_TIMEOUT_MS,
} from '../../config/timeouts.js';
import { CEE_PROXY_BODY_LIMIT } from '../../config/constants.js';

// Timeout configurations per endpoint — sourced from central config
const TIMEOUTS = {
  'graph-readiness': CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS,
  'sensitivity-coach': CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS,
  'prompts/warm': CEE_PROXY_PROMPTS_WARM_TIMEOUT_MS,
};

type CeeEndpoint = keyof typeof TIMEOUTS;

/**
 * Endpoints for which an empty body is a valid request.
 *
 * prompts/warm: {} means "warm all prompts" — CEE /assist/v1/prompts/warm
 * accepts it (200), and the UI's prompt-preloader sends exactly {} on every
 * page load. Rejecting it caused a silent warm-up failure on every page load
 * (ROADMAP 2.54(c), SCORECARD §3).
 */
const EMPTY_BODY_ALLOWED: ReadonlySet<CeeEndpoint> = new Set(['prompts/warm']);

/**
 * Create a CEE proxy route handler.
 *
 * Error handling follows the cee-draft-graph.ts passthrough pattern:
 * 1. CEE JSON responses (any status) → forwarded as-is
 * 2. Non-JSON CEE errors → wrapped in BFF envelope
 * 3. AbortError → UpstreamTimeoutError with timeoutPhase
 * 4. Client disconnect → ClientDisconnectError
 * 5. Other fetch errors → 502 with details
 */
function createCeeProxyHandler(endpoint: CeeEndpoint) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    const correlationId = (req.headers['x-correlation-id'] as string) || requestId;

    // Validate body exists (endpoints in EMPTY_BODY_ALLOWED accept {} / no body)
    const allowEmptyBody = EMPTY_BODY_ALLOWED.has(endpoint);
    if (!allowEmptyBody && (!req.body || typeof req.body !== 'object' || Object.keys(req.body as object).length === 0)) {
      return reply.code(400).send({
        error: 'Request body required',
        request_id: requestId,
      });
    }
    const forwardBody = (req.body && typeof req.body === 'object') ? req.body : {};

    const baseUrl = process.env.CEE_BASE_URL?.trim();
    const apiKey = process.env.CEE_API_KEY?.trim();

    if (!baseUrl || !apiKey) {
      reply.header('X-Request-Id', requestId);
      return reply.code(503).send({
        error: 'CEE_CONFIG_MISSING',
        message: 'CEE_BASE_URL or CEE_API_KEY not configured',
        retryable: false,
        request_id: requestId,
      });
    }

    // Extract query string from URL (critical for ?schema=v3)
    const queryString = req.url.includes('?') ? req.url.split('?')[1] : '';

    // Build URL with query string preserved
    const urlBase = `${baseUrl.replace(/\/$/, '')}/assist/v1/${endpoint}`;
    const url = queryString ? `${urlBase}?${queryString}` : urlBase;

    const timeoutMs = TIMEOUTS[endpoint];
    const startMs = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    timeoutId.unref();

    // Detect client disconnect — abort upstream if client drops
    const onClientClose = () => { controller.abort(); };
    req.raw.on('close', onClientClose);

    // Parse query params for logging
    const queryParams = new URLSearchParams(queryString);
    const schemaRequested = queryParams.get('schema') || 'none';

    // Log at request ingress
    req.log.info({
      evt: 'bff.cee_proxy.request',
      endpoint,
      cee_url: urlBase,
      timeout_ms: timeoutMs,
      request_id: requestId,
      correlation_id: correlationId,
      schema_requested: schemaRequested,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Olumi-Assist-Key': apiKey,
          'X-Request-Id': requestId,
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify(forwardBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      req.raw.removeListener('close', onClientClose);
      const ceeElapsedMs = Date.now() - startMs;

      reply.header('X-Request-Id', requestId);
      reply.header('X-CEE-Latency-Ms', String(ceeElapsedMs));

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      // ── Success path ────────────────────────────────────────────────
      if (res.ok) {
        const data = isJson ? await res.json() : await res.text();
        const bffTotalElapsedMs = Date.now() - startMs;

        req.log.info({
          evt: 'bff.cee_proxy.response',
          endpoint,
          status: res.status,
          cee_elapsed_ms: ceeElapsedMs,
          bff_total_elapsed_ms: bffTotalElapsedMs,
          request_id: requestId,
        });

        return reply.code(res.status).send(data);
      }

      // ── CEE error path — passthrough pattern ────────────────────────
      // Read upstream body once — fetch stream is single-consume
      const rawText = await res.text().catch(() => '');
      let parsed: any = null;
      if (isJson || rawText.trimStart().startsWith('{')) {
        try { parsed = JSON.parse(rawText); } catch { /* not valid JSON */ }
      }

      // 1. Any parseable JSON object → passthrough as-is (preserves CEE error shape)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const bffTotalElapsedMs = Date.now() - startMs;

        req.log.info({
          evt: 'bff.cee_proxy.response',
          endpoint,
          status: res.status,
          cee_elapsed_ms: ceeElapsedMs,
          bff_total_elapsed_ms: bffTotalElapsedMs,
          request_id: requestId,
        });

        return reply.code(res.status).send(parsed);
      }

      // 2. Non-JSON or unrecognised — wrap with diagnostics
      {
        const elapsedMs = Date.now() - startMs;
        const upstreamContentType = contentType || 'unknown';
        const upstreamBodyPreview = rawText.slice(0, 500);

        req.log.warn({
          evt: 'bff.cee_proxy.error',
          endpoint,
          error_code: `CEE_HTTP_${res.status}`,
          error_message: `CEE returned non-JSON ${res.status} response`,
          upstream_content_type: upstreamContentType,
          upstream_body_preview: upstreamBodyPreview,
          elapsed_ms: elapsedMs,
          request_id: requestId,
        });

        return reply.code(res.status).send({
          error: 'CEE_UPSTREAM_ERROR',
          message: `CEE returned non-JSON ${res.status} response`,
          retryable: res.status >= 500 || res.status === 429,
          upstream_content_type: upstreamContentType,
          upstream_body_preview: upstreamBodyPreview,
          elapsed_ms: elapsedMs,
          request_id: requestId,
        });
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      req.raw.removeListener('close', onClientClose);
      const elapsedMs = Date.now() - startMs;

      reply.header('X-Request-Id', requestId);

      if (err.name === 'AbortError') {
        // Distinguish client disconnect from provider timeout
        const clientDisconnected = req.raw.destroyed || req.raw.closed;

        if (clientDisconnected) {
          // Client abort — request was cancelled by the caller
          req.log.warn({
            evt: 'bff.cee_proxy.client_disconnect',
            endpoint,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          });

          return reply.code(499).send({
            error: 'ClientDisconnectError',
            message: 'Client disconnected before CEE responded',
            elapsed_ms: elapsedMs,
            request_id: requestId,
          });
        }

        // Provider timeout — CEE did not respond in time
        // Determine timeoutPhase: if signal was already aborted before fetch
        // started, it's "pre_aborted"; otherwise it's "body" (waiting for response)
        const timeoutPhase = elapsedMs < 50 ? 'pre_aborted' : 'body';

        req.log.warn({
          evt: 'bff.cee_proxy.timeout',
          endpoint,
          timeout_ms: timeoutMs,
          elapsed_ms: elapsedMs,
          timeout_phase: timeoutPhase,
          request_id: requestId,
        });

        return reply.code(504).send({
          error: 'UpstreamTimeoutError',
          message: `CEE did not respond within ${Math.round(timeoutMs / 1000)}s`,
          retryable: true,
          timeoutPhase,
          timeout_ms: timeoutMs,
          elapsed_ms: elapsedMs,
          request_id: requestId,
        });
      }

      // Network / other fetch error
      req.log.warn({
        evt: 'bff.cee_proxy.error',
        endpoint,
        error_code: 'CEE_NETWORK_ERROR',
        error_message: err.message || 'Failed to connect to CEE',
        elapsed_ms: elapsedMs,
        request_id: requestId,
      });

      return reply.code(502).send({
        error: 'CEE_NETWORK_ERROR',
        message: err.message || 'Failed to connect to CEE',
        retryable: true,
        elapsed_ms: elapsedMs,
        request_id: requestId,
      });
    }
  };
}

export async function registerCeeProxyRoutes(app: FastifyInstance) {
  // POST /v1/cee/graph-readiness
  app.post('/v1/cee/graph-readiness', { bodyLimit: CEE_PROXY_BODY_LIMIT }, createCeeProxyHandler('graph-readiness'));
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/graph-readiness',
    timeout_ms: TIMEOUTS['graph-readiness'],
  });

  // POST /v1/cee/bias-check — RETIRED (ROADMAP 2.632). Deliberately not registered;
  // see the file header. `tests/cee-proxy-smoke.test.ts` pins the 404.

  // POST /v1/cee/sensitivity-coach
  app.post('/v1/cee/sensitivity-coach', { bodyLimit: CEE_PROXY_BODY_LIMIT }, createCeeProxyHandler('sensitivity-coach'));
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/sensitivity-coach',
    timeout_ms: TIMEOUTS['sensitivity-coach'],
  });

  // POST /v1/cee/prompts/warm
  app.post('/v1/cee/prompts/warm', { bodyLimit: CEE_PROXY_BODY_LIMIT }, createCeeProxyHandler('prompts/warm'));
  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/prompts/warm',
    timeout_ms: TIMEOUTS['prompts/warm'],
  });
}
