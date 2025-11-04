/**
 * POST /assist/explain-diff - Explain differences between two graphs (PROXY)
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

interface ExplainDiffRequest {
  before: unknown;
  after: unknown;
  context?: string;
}

export async function registerExplainDiffRoute(app: FastifyInstance) {
  app.post('/assist/explain-diff', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as ExplainDiffRequest;

    try {
      // Apply guards
      guardRequestSize(request);

      // Validate input
      if (!body.before || !body.after) {
        throw createGuardError('BAD_INPUT', 'Both before and after graphs are required');
      }

      // Basic graph structure validation
      const before = body.before as any;
      const after = body.after as any;

      if (!before.nodes || !before.edges || !after.nodes || !after.edges) {
        throw createGuardError('BAD_INPUT', 'Graphs must have nodes and edges arrays');
      }

      // Telemetry: request start
      const startMs = Date.now();
      app.log.info({
        event: 'assist.proxy.request',
        method: 'POST',
        route: '/assist/explain-diff',
        requestId: request.id,
      }, 'Proxying explain-diff request');

      // Proxy to upstream
      const proxyResponse = await proxyRequest({
        method: 'POST',
        path: '/assist/explain-diff',
        body: {
          before: body.before,
          after: body.after,
          context: body.context,
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
        ...(responseBody.changes && Array.isArray(responseBody.changes) && { changes_count: responseBody.changes.length }),
        ...(responseBody.model && { model: responseBody.model }),
      }, 'Explain diff proxy completed');

      return proxyResponse.body;

    } catch (error: any) {
      app.log.error({
        error: error.message,
        code: error.code,
        status: error.status,
      }, 'Explain diff proxy failed');

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

  app.log.info({ routes: ['/assist/explain-diff'] }, 'Explain diff proxy route registered');
}
