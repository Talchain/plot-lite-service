/**
 * POST /v1/analysis/thresholds — WITHDRAWN (typed 501 refusal).
 *
 * Ruled VACUOUS by the PLoT sibling-route authenticity matrix of 2026-07-26
 * and by the 26 Jul ruling (Paul-ratified). The route scored every option by
 * running the inference engine over the SAME shared graph, varying only a seed
 * derived from the loop index:
 *
 *     const optionSeed = seed + i + 1;
 *     inferenceEngine.run(graph, { seed: optionSeed, ... });
 *
 * The option node contributed its id and label to the output and nothing else.
 * No intervention was applied and no subgraph was selected, so nothing about
 * option i entered the computation for option i. The seed was then shown to be
 * inert on this path (4242 vs 99999 gave identical output), which makes the
 * vacuity a proof rather than an observation: every option was guaranteed a
 * byte-identical distribution, for every graph, for all inputs.
 *
 * Consequence for this route specifically:
 *   a threshold is defined as an option-ranking flip, and options can never differ, so analysis.thresholds was a structural constant [].
 *
 * The local fallback is not a degraded edge case — it is the only behaviour
 * staging has. ISL 404s on every /api/v1/analysis/* endpoint, and ISL was in
 * any case only ever handed the already-identical option results.
 *
 * WHY REFUSE RATHER THAN DELETE: a 404 is indistinguishable from a typo and
 * destroys the evidence. The typed 501 says the capability was withdrawn and
 * why, and keeps the path mounted so caller telemetry can establish who — if
 * anyone — was relying on it. See src/routes/v1/refuse-unavailable.ts and
 * src/observability/routeCallerTelemetry.ts.
 *
 * The compute internals were deleted with the route. They were module-local
 * (never exported), so nothing outside this file could consume them. Shared
 * helpers it used — normalizeGraph, inferEdgeTypes, detectPrimaryOutcome,
 * islService — are untouched and still used by live routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { refuseUnavailable, VACUOUS_ANALYSIS_REASON } from './refuse-unavailable.js';

export async function registerThresholdsRoute(app: FastifyInstance) {
  app.post('/v1/analysis/thresholds', async (req: FastifyRequest, reply: FastifyReply) =>
    refuseUnavailable(req, reply, '/v1/analysis/thresholds', VACUOUS_ANALYSIS_REASON)
  );
}
