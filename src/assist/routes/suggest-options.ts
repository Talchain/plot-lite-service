/**
 * POST /assist/suggest-options - Suggest strategic options (PROXY)
 *
 * Proxies to standalone assistants service with shared guards.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { proxyRequest } from '../proxy/client.js';
import {
  guardRequestSize,
  guardResponseSize,
  createGuardError,
} from '../proxy/guard.js';

interface SuggestOptionsRequest {
  goal: string;
  constraints?: Record<string, unknown>;
  existingOptions?: string[];
}

export async function registerSuggestOptionsRoute(app: FastifyInstance) {
  app.post('/assist/suggest-options', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as SuggestOptionsRequest;

    try {
      // Apply guards
      guardRequestSize(request);

      // Validate goal
      if (!body.goal || typeof body.goal !== 'string' || body.goal.trim().length === 0) {
        throw createGuardError('BAD_INPUT', 'Goal is required and must be a non-empty string');
      }

      if (body.goal.length > 1000) {
        throw createGuardError('BAD_INPUT', `Goal too long (${body.goal.length} chars, max 1000)`);
      }

      // Telemetry: request start
      const startMs = Date.now();
      app.log.info({
        event: 'assist.proxy.request',
        method: 'POST',
        route: '/assist/suggest-options',
        requestId: request.id,
      }, 'Proxying suggest-options request');

      // Proxy to upstream
      const proxyResponse = await proxyRequest({
        method: 'POST',
        path: '/assist/suggest-options',
        body: {
          goal: body.goal,
          constraints: body.constraints,
          existingOptions: body.existingOptions,
        },
        requestId: request.id,
      });

      const latencyMs = Date.now() - startMs;

      // Handle upstream error responses
      if (proxyResponse.status >= 400) {
        app.log.warn({
          event: 'assist.proxy.response',
          status: proxyResponse.status,
          latencyMs,
          retried: proxyResponse.retried,
        }, 'Upstream returned error');

        return reply.code(proxyResponse.status).send(proxyResponse.body);
      }

      // Guard response size
      guardResponseSize(proxyResponse.body);

      const responseBody = proxyResponse.body as any;

      // Telemetry: success (always include provider and cost_usd with fallbacks)
      const provider = responseBody.provider || 'unknown';
      const costUsd = typeof responseBody.cost_usd === 'number' ? responseBody.cost_usd : 0;

      app.log.info({
        event: 'assist.proxy.response',
        status: proxyResponse.status,
        latencyMs,
        retried: proxyResponse.retried,
        bytes: JSON.stringify(proxyResponse.body).length,
        provider,
        cost_usd: costUsd,
        ...(responseBody.options && Array.isArray(responseBody.options) && { options_count: responseBody.options.length }),
        ...(responseBody.model && { model: responseBody.model }),
      }, 'Suggest options proxy completed');

      return proxyResponse.body;

    } catch (error: any) {
      app.log.error({
        error: error.message,
        code: error.code,
        status: error.status,
      }, 'Suggest options proxy failed');

      const statusCode = error.type === 'BAD_INPUT' ? 400 :
        error.type === 'PAYLOAD_TOO_LARGE' ? 413 :
        error.code === 'PROXY_DISABLED' ? 503 :
        error.code === 'UPSTREAM_FAILURE' ? 502 :
        500;

      return reply.code(statusCode).send({
        error: {
          type: error.type || error.code || 'INTERNAL_ERROR',
          message: error.message || 'Internal server error',
        },
      });
    }
  });

  app.log.info({ routes: ['/assist/suggest-options'] }, 'Suggest options proxy route registered');
}
