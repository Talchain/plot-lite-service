/**
 * POST /v1/run_timeslices — WITHDRAWN (typed 501 refusal).
 *
 * Ruled FABRICATING on 2026-08-13, the same finding as `/v1/sensitivity` and
 * `/v1/score` under the numerics science review of 2026-07-26: the published
 * numbers were a closed-form function of the seed and a name hash, with the
 * request graph never entering the computation.
 *
 * THE WHOLE PER-SLICE COMPUTATION WAS:
 *
 *     const sliceHash = createHash('sha256').update(slice).digest('hex').slice(0, 8);
 *     const sliceSeed = seed + parseInt(sliceHash, 16) % 10000;
 *     // Placeholder: deterministic p50 based on slice seed
 *     const baseP50   = Math.round((sliceSeed / 10000 + 0.5) * 1000) / 1000;
 *     const p10 = Math.round(baseP50 * 0.8 * 1000) / 1000;
 *     const p90 = Math.round(baseP50 * 1.2 * 1000) / 1000;
 *     const confidence = 0.85;
 *
 * Three separate claims in that block were false to the caller:
 *
 *   1. THE DISTRIBUTION WAS A NAME HASH. p50 was determined by `seed` and the
 *      SHA-256 of the slice LABEL. Rename '2026-Q1' to 'Q1' and the forecast
 *      moves; change every weight, belief and value in the graph and it does
 *      not. p10/p90 were not estimated at all — they were p50 × 0.8 and
 *      p50 × 1.2, a fixed ±20% band that encodes no uncertainty about anything.
 *
 *   2. THE GRAPH WAS READ, THEN DISCARDED — which is worse than never reading
 *      it. The handler validated `graph.nodes`/`graph.edges` against the public
 *      limits, validated `priors` against the node ids, validated `evidence`
 *      against the node ids, and assembled a per-slice `sliceGraph` by merging
 *      `slice_overrides` node-by-node and swapping in override edges. Every one
 *      of those steps ran, and `sliceGraph` was then never referenced again.
 *      A caller supplying per-slice overrides received positive confirmation
 *      that their edits had been accepted — a 200, no warning — while the
 *      arithmetic that produced the numbers could not see them.
 *
 *   3. `confidence: 0.85` WAS A LITERAL, on every slice of every request, for
 *      all inputs. It was not a computed figure that happened to be stable.
 *
 * And it shipped under a `model_card` carrying `seed`, `response_hash` and
 * `timeslices_count` — a determinism stamp that held only because the output
 * was a constant function of the input, which is exactly the shape that makes a
 * fabricated number read as a measured one. Same trap as `/v1/counterfactual`
 * (ROADMAP 2.105): the numbers were placeholders and the credibility furniture
 * around them was not.
 *
 * WHY REFUSE RATHER THAN DELETE. A 404 is indistinguishable from a typo and
 * destroys the evidence. This route is published in `contracts/openapi.yaml`,
 * carries an SDK method (`sdk/src/client.ts` `runTimeslices()`), a worked SDK
 * example and a README entry, so an integrator may hold a client built against
 * it. The typed 501 tells that caller the capability was withdrawn and why, and
 * keeps the path mounted so `routeCallerTelemetry` can establish who — if
 * anyone — was relying on it. That evidence is the whole reason the path stays
 * mounted; see src/routes/v1/refuse-unavailable.ts.
 *
 * WHAT WAS DELETED WITH THE ROUTE. Only module-local code: the validation
 * chain, the override merge and the placeholder arithmetic, none of which was
 * exported. Shared helpers it imported — `validatePriors`, `validateEvidence`,
 * `sanitizeEvidence`, `recordAuditEvent`, the limits constants — are untouched
 * and still used by live routes. `MAX_TIMESLICES` was module-local and is gone
 * with the handler it bounded.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  refuseUnavailable,
  FABRICATED_NUMERICS_REASON,
  WITHDRAWN_ROUTE_OPTIONS,
} from './refuse-unavailable.js';

export async function registerRunTimeslicesRoute(app: FastifyInstance) {
  app.post('/v1/run_timeslices', WITHDRAWN_ROUTE_OPTIONS, async (req: FastifyRequest, reply: FastifyReply) =>
    refuseUnavailable(req, reply, '/v1/run_timeslices', FABRICATED_NUMERICS_REASON)
  );
}
