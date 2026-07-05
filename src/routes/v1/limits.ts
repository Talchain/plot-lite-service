/**
 * GET /v1/limits - Return configured graph size limits
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  BODY_LIMIT_BYTES,
  LIMITS_MAX_NODES,
  LIMITS_MAX_EDGES,
  LIMITS_MAX_OPTIONS,
  LIMITS_SWEET_SPOT_NODES,
  LIMITS_WARNING_NODES,
  LIMITS_SWEET_SPOT_EDGES,
  LIMITS_WARNING_EDGES,
} from '../../config/constants.js';
import { FLAGS } from '../../config/flags.js';
import { getRateLimitRpm } from '../../config/runtimeConfig.js';
import {
  RUN_CRITIQUE_NODE_LIMIT,
  RUN_EDGE_SOFT_LIMIT,
  RUN_EDGE_HARD_LIMIT,
} from '../../constants/limits.js';

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
      max_options: LIMITS_MAX_OPTIONS,
      max_body_kb: Math.floor(BODY_LIMIT_BYTES / 1024),
      max_payload_bytes: BODY_LIMIT_BYTES,
      rate_limit_rpm: rateLimitRpm,
      sweet_spot_nodes: LIMITS_SWEET_SPOT_NODES,
      sweet_spot_edges: LIMITS_SWEET_SPOT_EDGES,
      warning_nodes: LIMITS_WARNING_NODES,
      warning_edges: LIMITS_WARNING_EDGES,
      // Run-path critique thresholds (additive; see src/constants/limits.ts).
      // Beyond these the run still computes but critique flags the graph size.
      run_critique_node_limit: RUN_CRITIQUE_NODE_LIMIT,
      run_edge_soft_limit: RUN_EDGE_SOFT_LIMIT,
      run_edge_hard_limit: RUN_EDGE_HARD_LIMIT,
      flags: {
        scm_lite: FLAGS.SCM_LITE_ENABLE ? 1 : 0,
        validate_patch: FLAGS.ENABLE_VALIDATE_PATCH ? 1 : 0,
        facts_assembly: FLAGS.ENABLE_FACTS_ASSEMBLY ? 1 : 0,
        review_pass: FLAGS.ENABLE_REVIEW_PASS ? 1 : 0,
      },
    };
    
    return reply
      .code(200)
      .header('Cache-Control', 'public, max-age=3600')
      .type('application/json')
      .send(response);
  });
}
