/**
 * POST /v1/cee/draft-graph - CEE Draft Graph BFF Proxy
 *
 * Proxies draft-graph requests to CEE /assist/v1/draft-graph.
 * This endpoint allows the UI to bypass Netlify's ~50s Edge Function timeout
 * by routing through PLoT with explicit timeout above CEE's 90s budget.
 *
 * Authentication: CEE_API_KEY is injected server-side, never exposed to client.
 * Timeout: CEE_PROXY_TIMEOUT_MS (default 105 000ms), configurable via env var.
 *
 * Error handling:
 *   - CEE JSON errors (4xx/5xx with error field) are forwarded as-is.
 *   - Non-JSON CEE errors (e.g. Render HTML pages) are wrapped in a BFF error.
 *   - Proxy timeout produces HTTP 504 with typed CEE_PROXY_TIMEOUT error.
 *
 * @see https://github.com/olumi/plot-lite-service/docs/cee-proxy.md
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { CEE_PROXY_TIMEOUT_MS } from '../../config/timeouts.js';

export async function registerCeeDraftGraphRoute(app: FastifyInstance) {
  // Log effective config at startup
  app.log.info({
    evt: 'bff.config.cee_proxy_timeout',
    timeout_ms: CEE_PROXY_TIMEOUT_MS,
  });

  app.post(
    '/v1/cee/draft-graph',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const requestId = String(req.id);
      const correlationId = (req.headers['x-correlation-id'] ||
        req.headers['X-Correlation-Id']) as string | undefined;

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

      const urlBase = `${baseUrl.replace(/\/$/, '')}/assist/v1/draft-graph`;
      const url = queryString ? `${urlBase}?${queryString}` : urlBase;

      const startMs = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CEE_PROXY_TIMEOUT_MS);
      timeoutId.unref();

      // bff.cee_proxy.request
      req.log.info({
        evt: 'bff.cee_proxy.request',
        cee_url: urlBase,
        timeout_ms: CEE_PROXY_TIMEOUT_MS,
        request_id: requestId,
      });

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Olumi-Assist-Key': apiKey,
            'X-Request-Id': requestId,
            ...(correlationId && { 'X-Correlation-Id': correlationId }),
          },
          body: JSON.stringify(req.body),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const ceeElapsedMs = Date.now() - startMs;

        reply.header('X-Request-Id', requestId);
        reply.header('X-CEE-Latency-Ms', String(ceeElapsedMs));

        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        // ── Success path ──────────────────────────────────────────────
        if (res.ok) {
          const data = isJson ? await res.json() : await res.text();
          const bffTotalElapsedMs = Date.now() - startMs;

          // bff.cee_proxy.response
          req.log.info({
            evt: 'bff.cee_proxy.response',
            status: res.status,
            cee_elapsed_ms: ceeElapsedMs,
            bff_total_elapsed_ms: bffTotalElapsedMs,
            request_id: requestId,
          });

          return reply.code(res.status).send(data);
        }

        // ── CEE error path ────────────────────────────────────────────
        if (isJson) {
          let body: any;
          try {
            body = await res.json();
          } catch {
            body = null;
          }

          // CEE typed JSON error — passthrough as-is (covers CEE_LLM_TIMEOUT,
          // CEE_REQUEST_BUDGET_EXCEEDED, validation 422, rate-limit 429, etc.)
          if (body && typeof body === 'object' && 'error' in body) {
            const bffTotalElapsedMs = Date.now() - startMs;

            // bff.cee_proxy.response (for passthrough errors too)
            req.log.info({
              evt: 'bff.cee_proxy.response',
              status: res.status,
              cee_elapsed_ms: ceeElapsedMs,
              bff_total_elapsed_ms: bffTotalElapsedMs,
              request_id: requestId,
            });

            reply.header('X-Request-Id', requestId);
            return reply.code(res.status).send(body);
          }
        }

        // ── Non-JSON content-type — try JSON parse anyway (intermediaries
        //    like Render sometimes strip content-type), then wrap if it fails ──
        {
          const rawText = await res.text().catch(() => '');
          let parsed: any = null;
          try { parsed = JSON.parse(rawText); } catch { /* not JSON */ }

          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            const bffTotalElapsedMs = Date.now() - startMs;
            req.log.info({
              evt: 'bff.cee_proxy.response',
              status: res.status,
              cee_elapsed_ms: ceeElapsedMs,
              bff_total_elapsed_ms: bffTotalElapsedMs,
              request_id: requestId,
            });
            reply.header('X-Request-Id', requestId);
            return reply.code(res.status).send(parsed);
          }

          const elapsedMs = Date.now() - startMs;
          const upstreamContentType = contentType || 'unknown';
          const upstreamBodyPreview = rawText.slice(0, 500);

          // bff.cee_proxy.error — include raw-body preview for diagnostics
          req.log.warn({
            evt: 'bff.cee_proxy.error',
            error_code: `CEE_HTTP_${res.status}`,
            error_message: `CEE returned non-JSON ${res.status} response`,
            upstream_content_type: upstreamContentType,
            upstream_body_preview: upstreamBodyPreview,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          });

          reply.header('X-Request-Id', requestId);
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
        const elapsedMs = Date.now() - startMs;

        reply.header('X-Request-Id', requestId);

        if (err.name === 'AbortError') {
          // bff.cee_proxy.timeout
          req.log.warn({
            evt: 'bff.cee_proxy.timeout',
            timeout_ms: CEE_PROXY_TIMEOUT_MS,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          });

          return reply.code(504).send({
            error: 'CEE_PROXY_TIMEOUT',
            message: `CEE did not respond within ${Math.round(CEE_PROXY_TIMEOUT_MS / 1000)}s`,
            retryable: true,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          });
        }

        // Network / other fetch error
        // bff.cee_proxy.error
        req.log.warn({
          evt: 'bff.cee_proxy.error',
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
    }
  );

  app.log.info({
    evt: 'route_registered',
    route: 'POST /v1/cee/draft-graph',
    timeout_ms: CEE_PROXY_TIMEOUT_MS,
  });
}
