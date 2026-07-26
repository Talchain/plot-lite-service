/**
 * POST /v1/analysis/optimise — WITHDRAWN (typed 501 refusal).
 *
 * Ruled VACUOUS by the PLoT sibling-route authenticity matrix of 2026-07-26.
 * This route failed hardest of the seven, and by a different mechanism from
 * the other six: it never used the option loop at all. Its local fallback
 * simply did not receive the graph.
 *
 *     function computeLocalOptimise(decisionVariable, searchRange,
 *                                   objectiveDirection, gridPoints) {
 *       // …no graph parameter…
 *       // Mock objective: simple parabola with max at midpoint
 *       const objective = 100 - 100 * normalizedDist * normalizedDist;
 *
 * So the returned optimum was always the grid point nearest the midpoint of
 * `search_range`; `gradient_at_optimum` was the literal 0; `second_derivative`
 * was a pure function of the range. The causal graph — the thing supposedly
 * being optimised over — played no part.
 *
 * The probe battery makes this unambiguous: all six variants, INCLUDING the
 * positive control that moved every other route's numbers, returned one single
 * identical response hash (833a4bc5d3e5ef4a). Nothing about the request could
 * move the answer.
 *
 * The local fallback is not a degraded edge case — it is the only behaviour
 * staging has. ISL 404s on every /api/v1/analysis/* endpoint.
 *
 * WHY REFUSE RATHER THAN DELETE: a 404 is indistinguishable from a typo and
 * destroys the evidence. The typed 501 says the capability was withdrawn and
 * why, and keeps the path mounted so caller telemetry can establish who — if
 * anyone — was relying on it. This is also the one route of the seven that IS
 * declared in contracts/openapi.yaml, so a silent 404 would have put the
 * runtime out of step with a published contract; the contract is updated to
 * declare the 501 instead.
 *
 * The compute internals were deleted with the route. `computeLocalOptimise`
 * was module-local (never exported), so nothing outside this file could
 * consume it. Shared helpers it used — normalizeGraph, inferEdgeTypes,
 * islService, the ISL circuit breaker — are untouched and still used by live
 * routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { refuseUnavailable, VACUOUS_ANALYSIS_REASON } from './refuse-unavailable.js';

export async function registerAnalysisOptimiseRoute(app: FastifyInstance) {
  app.post('/v1/analysis/optimise', async (req: FastifyRequest, reply: FastifyReply) =>
    refuseUnavailable(req, reply, '/v1/analysis/optimise', VACUOUS_ANALYSIS_REASON)
  );
}
