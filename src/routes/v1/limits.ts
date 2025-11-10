/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { FLAGS } from '../../config/flags.js';
import { getRateLimitRpm } from '../../config/runtimeConfig.js';

// Precedence: ENV > runtimeConfig > FLAGS
function getEffectiveRpm(): number {
  const env = process.env.RATE_LIMIT_RPM;
  if (env !== undefined && env !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  try {
    const rc = getRateLimitRpm();
    if (Number.isFinite(rc) && rc > 0) return rc;
  } catch {}
  return FLAGS.RATE_LIMIT_RPM;
}

export async function registerLimitsRoute(app: FastifyInstance) {
  app.get('/v1/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    const response = {
      limits_source: 'config',
      rate_limit_rpm: getEffectiveRpm(),
      flags: {
        scm_lite: FLAGS.SCM_LITE_ENABLE ? 1 : 0,
      },
      nodes: {
        max: Number(process.env.GRAPH_MAX_NODES || 200),
      },
      edges: {
        max: Number(process.env.GRAPH_MAX_EDGES || 500),
      },
    };
    
    return reply.code(200).type('application/json').send(response);
  });
}
