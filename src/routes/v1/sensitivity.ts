/**
 * POST /v1/sensitivity — WITHDRAWN (typed 501 refusal).
 *
 * Ruled FABRICATING by the PLoT numerics science review of 2026-07-26, and
 * independently re-verified at the code and by live probe before withdrawal.
 *
 * The "tornado" was a closed-form function of the seed and the node's own
 * `value`:
 *
 *     const baselineP50 = Math.round((baselineSeed / 10000 + 0.5) * 1000) / 1000;
 *     const lowEffect   = Math.round((baselineSeed / 10000 + lowValue * 0.1
 *                                     - baselineP50) * 1000) / 1000;
 *
 * `body.graph.edges` was never read — `edges` appeared in this file ONLY in the
 * TypeScript declaration of the request type, never in the handler. The causal
 * structure the endpoint claimed to analyse played no part in the answer, and
 * the driver ranking (`|low| + |high|`) reduced to ranking nodes by their own
 * value.
 *
 * Verification probe run against the real app before this change, positive
 * control first:
 *
 *     edge weights x1000   -> response byte-identical to base
 *     ALL edges deleted    -> response byte-identical to base
 *     node value 0.4->9999 -> response moves (so the probe is not blind)
 *
 * Two aggravating factors made this worse than merely wrong. It reported
 * `evaluations: 1 + 2 * targets.length`, asserting model evaluations that never
 * occurred; and it wrote `inference_mode: 'model_based'` into the audit ring —
 * a provenance claim for an inference that never ran.
 *
 * That is what makes this worse than the vacuous analysis routes: a vacuous
 * route returns nothing useful, whereas this returned plausible numbers under a
 * fabricated provenance stamp, which a caller has no way to detect.
 *
 * The path stays mounted rather than 404ing so caller telemetry can establish
 * who was relying on it. See src/routes/v1/refuse-unavailable.ts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { refuseUnavailable, FABRICATED_NUMERICS_REASON, WITHDRAWN_ROUTE_OPTIONS } from './refuse-unavailable.js';

export async function registerSensitivityRoute(app: FastifyInstance) {
  app.post('/v1/sensitivity', WITHDRAWN_ROUTE_OPTIONS, async (req: FastifyRequest, reply: FastifyReply) =>
    refuseUnavailable(req, reply, '/v1/sensitivity', FABRICATED_NUMERICS_REASON)
  );
}
