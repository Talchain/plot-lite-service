/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerLimitsRoute(app: FastifyInstance) {
  app.get('/v1/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    const response = {
      schema: 'limits.v1',
      max_nodes: Number(process.env.GRAPH_MAX_NODES || 50),
      max_edges: Number(process.env.GRAPH_MAX_EDGES || 200),
      max_body_kb: 128,
    };
    
    return reply.code(200).type('application/json').send(response);
  });
}
