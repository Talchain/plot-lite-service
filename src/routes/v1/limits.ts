/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  BODY_LIMIT_BYTES,
  LIMITS_MAX_NODES,
  LIMITS_MAX_EDGES,
  LIMITS_SWEET_SPOT_NODES,
  LIMITS_WARNING_NODES,
  LIMITS_SWEET_SPOT_EDGES,
  LIMITS_WARNING_EDGES,
} from '../../config/constants.js';
import { FLAGS } from '../../config/flags.js';
import { getRateLimitRpm } from '../../config/runtimeConfig.js';

export async function registerLimitsRoute(app: FastifyInstance) {
  app.get('/v1/limits', async (_req: FastifyRequest, reply: FastifyReply) => {
    const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== '0';
    let rateLimitRpm = 0;
    if (rateLimitEnabled) {
      const env = process.env.RATE_LIMIT_RPM;
      if (env !== undefined && env !== '') {
        const n = Number(env);
        if (Number.isFinite(n) && n >= 0) {
          rateLimitRpm = n;
        }
      }
      if (rateLimitRpm === 0) {
        try {
          const snapshotRpm = getRateLimitRpm();
          if (Number.isFinite(snapshotRpm) && snapshotRpm > 0) {
            rateLimitRpm = snapshotRpm;
          }
        } catch {
          // ignore runtime config errors and fall back to FLAGS
        }
      }
      if (rateLimitRpm === 0) {
        rateLimitRpm = FLAGS.RATE_LIMIT_RPM;
      }
    }

    const response = {
      schema: 'limits.v1',
      max_nodes: LIMITS_MAX_NODES,
      max_edges: LIMITS_MAX_EDGES,
      max_body_kb: Math.floor(BODY_LIMIT_BYTES / 1024),
      max_payload_bytes: BODY_LIMIT_BYTES,
      rate_limit_rpm: rateLimitRpm,
      sweet_spot_nodes: LIMITS_SWEET_SPOT_NODES,
      sweet_spot_edges: LIMITS_SWEET_SPOT_EDGES,
      warning_nodes: LIMITS_WARNING_NODES,
      warning_edges: LIMITS_WARNING_EDGES,
      flags: {
        scm_lite: FLAGS.SCM_LITE_ENABLE ? 1 : 0,
      },
    };
    
    return reply
      .code(200)
      .header('Cache-Control', 'public, max-age=3600')
      .type('application/json')
      .send(response);
  });
}
