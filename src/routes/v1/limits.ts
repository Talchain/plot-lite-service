/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerLimitsRoute(app: FastifyInstance) {
  app.get('/v1/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    const limits = {
      nodes: {
        max: Number(process.env.GRAPH_MAX_NODES || 200),
      },
      edges: {
        max: Number(process.env.GRAPH_MAX_EDGES || 500),
      },
    };
    
    return reply.code(200).type('application/json').send(limits);
  });
}
