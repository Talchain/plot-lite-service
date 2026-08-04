/**
 * POST /v1/cee/draft-graph - CEE Draft Graph BFF Proxy
 *
 * Proxies draft-graph requests to CEE /assist/v1/draft-graph.
 * This endpoint allows the UI to bypass Netlify's ~50s Edge Function timeout
 * by routing through PLoT with explicit timeout above CEE's 120s budget.
 *
 * Authentication: CEE_API_KEY is injected server-side, never exposed to client.
 * Timeout: CEE_PROXY_TIMEOUT_MS (default 135 000ms), configurable via env var.
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
import { CEE_PROXY_BODY_LIMIT } from '../../config/constants.js';
// CIL Phase 1: Shared error schemas from @talchain/schemas
import { CeeTypedErrorSchema } from '@talchain/schemas';
import type { PlotCeeUpstreamEnvelope, PlotProxyTimeoutError } from '@talchain/schemas';

export async function registerCeeDraftGraphRoute(app: FastifyInstance) {
  // Log effective config at startup
  app.log.info({
    evt: 'bff.config.cee_proxy_timeout',
    timeout_ms: CEE_PROXY_TIMEOUT_MS,
  });

  // F-70: CEE accepts 1MB; override global 128KB limit for proxy routes
  app.post(
    '/v1/cee/draft-graph',
    { bodyLimit: CEE_PROXY_BODY_LIMIT },
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
        // Read upstream body once — fetch stream is single-consume
        const rawText = await res.text().catch(() => '');
        let parsed: any = null;
        if (isJson || rawText.trimStart().startsWith('{')) {
          try { parsed = JSON.parse(rawText); } catch { /* not valid JSON */ }
        }

        // 1. CEE typed error (CeeTypedErrorSchema) — passthrough as-is
        //    Covers: CEE_LLM_TIMEOUT, CEE_REQUEST_BUDGET_EXCEEDED,
        //    CEE_LLM_UPSTREAM_ERROR, CEE_LLM_VALIDATION_FAILED,
        //    CEE_CLIENT_DISCONNECT, CEE_INTERNAL_ERROR
        if (parsed && typeof parsed === 'object' && CeeTypedErrorSchema.safeParse(parsed).success) {
          const bffTotalElapsedMs = Date.now() - startMs;

          req.log.info({
            evt: 'bff.cee_proxy.response',
            status: res.status,
            cee_elapsed_ms: ceeElapsedMs,
            bff_total_elapsed_ms: bffTotalElapsedMs,
            request_id: requestId,
          });

          return reply.code(res.status).send(parsed);
        }

        // 2. CEE cee.error.v1 schema — passthrough as-is
        //    Covers structured CEE errors (code field, trace, details) that
        //    don't match the CeeTypedErrorSchema enum above
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.schema === 'cee.error.v1') {
          const bffTotalElapsedMs = Date.now() - startMs;

          req.log.info({
            evt: 'bff.cee_proxy.response',
            status: res.status,
            cee_elapsed_ms: ceeElapsedMs,
            bff_total_elapsed_ms: bffTotalElapsedMs,
            request_id: requestId,
          });

          return reply.code(res.status).send(parsed);
        }

        // 3. Any JSON object with 'error' field — passthrough as-is
        //    Covers non-enum error codes and intermediaries that strip content-type
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed) {
          const bffTotalElapsedMs = Date.now() - startMs;

          req.log.info({
            evt: 'bff.cee_proxy.response',
            status: res.status,
            cee_elapsed_ms: ceeElapsedMs,
            bff_total_elapsed_ms: bffTotalElapsedMs,
            request_id: requestId,
          });

          return reply.code(res.status).send(parsed);
        }

        // 4. Non-JSON or unrecognized — wrap with diagnostics
        {
          const elapsedMs = Date.now() - startMs;
          const upstreamContentType = contentType || 'unknown';
          const upstreamBodyPreview = rawText.slice(0, 500);

          req.log.warn({
            evt: 'bff.cee_proxy.error',
            error_code: `CEE_HTTP_${res.status}`,
            error_message: `CEE returned non-JSON ${res.status} response`,
            upstream_content_type: upstreamContentType,
            upstream_body_preview: upstreamBodyPreview,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          });

          // CIL Phase 1: PLoT-generated error envelope typed by @talchain/schemas
          const envelope: PlotCeeUpstreamEnvelope = {
            error: 'CEE_UPSTREAM_ERROR',
            message: `CEE returned non-JSON ${res.status} response`,
            retryable: res.status >= 500 || res.status === 429,
            upstream_content_type: upstreamContentType,
            upstream_body_preview: upstreamBodyPreview,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          };
          return reply.code(res.status).send(envelope);
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

          // CIL Phase 1: PLoT-generated timeout error typed by @talchain/schemas
          const timeoutError: PlotProxyTimeoutError = {
            error: 'CEE_PROXY_TIMEOUT',
            message: `CEE did not respond within ${Math.round(CEE_PROXY_TIMEOUT_MS / 1000)}s`,
            retryable: true,
            elapsed_ms: elapsedMs,
            request_id: requestId,
          };
          return reply.code(504).send(timeoutError);
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
