/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerLimitsRoute(app: FastifyInstance) {
  app.get('/v1/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    const limits = {
      max_nodes: Number(process.env.GRAPH_MAX_NODES || 50),
      max_edges: Number(process.env.GRAPH_MAX_EDGES || 200),
      engine_p95_ms_budget: 600,
      // Legacy format (keep for backward compatibility)
      nodes: {
        max: Number(process.env.GRAPH_MAX_NODES || 50),
      },
      edges: {
        max: Number(process.env.GRAPH_MAX_EDGES || 200),
      },
    };
    
    return reply.code(200).type('application/json').send(limits);
  });
}
