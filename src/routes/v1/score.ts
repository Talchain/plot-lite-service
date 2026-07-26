/**
 * POST /v1/score — WITHDRAWN (typed 501 refusal).
 *
 * Ruled FABRICATING by the PLoT numerics science review of 2026-07-26, and
 * independently re-verified at the code and by live probe before withdrawal.
 *
 * Every published utility was a closed-form function of the seed and the
 * node's ARRAY INDEX:
 *
 *     const seedOffset = (seed + idx * 137) / 10000;
 *     const base = weight * seedOffset;
 *     const p10 = base + 0.1;  p50 = base + 0.5;  p90 = base + 0.9;
 *
 * Three consequences, each fatal on its own:
 *
 *   1. The percentile band is a CONSTANT 0.8 wide for every option, every
 *      graph, every input. It carries no uncertainty information at all.
 *   2. `expected` is the mean of those three, so it reduces to `base + 0.5` —
 *      and the published ranking therefore depends on each node's position in
 *      the array as much as on its weight.
 *   3. `body.graph.edges` was never read; `edges` appeared in this file only in
 *      the TypeScript declaration of the request type.
 *
 * Verification probe run against the real app before this change, two options
 * with IDENTICAL weights (0.5 / 0.5), swapped in the nodes array and nothing
 * else changed:
 *
 *     base : ranking ["optB","optA"]
 *     perm : ranking ["optA","optB"]
 *     band width p90-p10 : [0.8, 0.8]
 *     meta : {"seed":…, "inference_mode":"model_based"}
 *
 * The winner was decided by array order, and the response stamped
 * `inference_mode: 'model_based'` on the wire — a provenance claim for an
 * inference that never ran.
 *
 * That is what makes this worse than the vacuous analysis routes: a vacuous
 * route returns nothing useful, whereas this returned a plausible ranking under
 * a fabricated provenance stamp, which a caller has no way to detect.
 *
 * The path stays mounted rather than 404ing so caller telemetry can establish
 * who was relying on it. See src/routes/v1/refuse-unavailable.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { refuseUnavailable, FABRICATED_NUMERICS_REASON } from './refuse-unavailable.js';

export async function registerScoreRoute(app: FastifyInstance) {
  app.post('/v1/score', async (req: FastifyRequest, reply: FastifyReply) =>
    refuseUnavailable(req, reply, '/v1/score', FABRICATED_NUMERICS_REASON)
  );
}
