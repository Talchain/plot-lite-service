/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BODY_LIMIT_BYTES } from '../../config/constants.js';

export async function registerLimitsRoute(app: FastifyInstance) {
  app.get('/v1/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    const response = {
      schema: 'limits.v1',
      max_nodes: Number(process.env.GRAPH_MAX_NODES || 50),
      max_edges: Number(process.env.GRAPH_MAX_EDGES || 200),
      max_body_kb: Math.floor(BODY_LIMIT_BYTES / 1024),
      rate_limit_rpm: Number(process.env.RATE_LIMIT_PER_MIN || 60),
      flags: {
        scm_lite: process.env.SCM_LITE_ENABLE === '1' ? 1 : 0,
      },
    };
    
    return reply
      .code(200)
      .header('Cache-Control', 'public, max-age=3600')
      .type('application/json')
      .send(response);
  });
}
