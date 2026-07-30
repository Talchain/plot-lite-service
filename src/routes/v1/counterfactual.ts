/**
 * POST /v1/counterfactual — WITHDRAWN (typed 501 refusal). ROADMAP 2.105.
 *
 * Ruled a FABRICATION TRAP: the route returned a 200 carrying an estimate that
 * was placeholder arithmetic, wrapped in four independent layers of manufactured
 * credibility. Verified at the bytes before withdrawal (staging 3d13e0ac).
 *
 * WHAT IT PUBLISHED. The entire "computation" was two multiplications over
 * request inputs, self-commented as placeholders by its own author:
 *
 *     // Simulate counterfactual results
 *     const baseline_outcome = intervention.from_value * 100; // Placeholder
 *     const counterfactual_outcome = intervention.to_value * 95; // Placeholder
 *     const delta = counterfactual_outcome - baseline_outcome;
 *
 * `graph` was never read. `k_samples` / `budget.k` and `seed` never entered the
 * numbers. No causal model was evaluated and no counterfactual was computed: the
 * response was a fixed multiple of two fields the caller had just sent.
 *
 * WHY IT WAS WORSE THAN A VACUOUS ROUTE. A caller had no way to detect any of
 * this, because everything AROUND the number was real machinery:
 *
 *   1. A model card whose `assumptions` asserted causal machinery that never
 *      ran — "All else held constant (ceteris paribus)", "No spillover
 *      effects" — alongside the genuine identifiability summary.
 *   2. A confidence badge computed from HARD-CODED literals
 *      (`identifiable: true`, `in_linear_range: true`). `calculateConfidence`
 *      scores `identifiability_score = 1.0` and `linearity_score = 1.0` from
 *      those, and `k_coverage_score = 1.0` for the route's default
 *      `k_samples = 1000` — so the badge sat near its CEILING on every path, for
 *      every input, including the inputs it had not looked at.
 *   3. `buildModelCard` stamped "Deterministic: Same seed guarantees identical
 *      output". True — but only because the output was a constant function of
 *      the input.
 *   4. `buildExplainDelta` produced driver attributions computed OVER the
 *      placeholder values, so the explanation inherited the fabrication and
 *      presented it as decomposed causal contribution.
 *
 * Real work did happen — `enforceComputeBudget`, and `checkIdentifiability`
 * which returned a genuine 400 on a non-identifiable query — but all of it fed
 * the METADATA. None of it touched the estimate. That is the shape of the trap:
 * the trustworthy parts were real, so the untrustworthy part read as real too.
 *
 * THE ISL METHOD IS NOT THE ESCAPE HATCH — IT IS A SECOND, SEPARATE DEAD END.
 * This route never called `integrations/isl`; it imported nothing from it. And
 * `ISLService.computeCounterfactual` has ZERO production callers and sends a body
 * ISL's mounted `CounterfactualRequest` REJECTS: it sends
 * `{ dag, intervention, target }` where ISL requires `model` and `outcome` —
 * pinned in tests/isl-request-drift-pairing.contract.test.ts, which asserts
 * `validation_errors === ['model:missing','outcome:missing']`. So "wiring it up
 * to ISL" was never the small change it looked like, and anyone who tried would
 * have fallen through to `createFallbackCounterfactual`, which returns
 * `estimate: 0`. The fabrication had no short path to becoming real.
 *
 * NOT THE REAL COUNTERFACTUAL PATH. The live capability is CEE/UI -> ISL
 * directly. Measured outside this repo at withdrawal time: the exact path string
 * "v1/counterfactual" has ZERO occurrences in DecisionGuideAI and ZERO in
 * olumi-assistants-service at their `staging` tips, while the UI's only
 * counterfactual call is `src/adapters/isl/client.ts` reaching ISL's
 * `causal/counterfactual/conformal` endpoint directly. Nothing consumed this
 * route.
 *
 * (That endpoint is deliberately NOT written here as a full `/api/v1/...`
 * literal: tests/isl-request-drift-pairing.contract.test.ts scans `src/` for
 * those literals and requires a manifest row for each, and PLoT does not call it
 * — the UI does. A row would be a false claim about this service.)
 *
 * WHY REFUSE RATHER THAN DELETE. Per the ratified disposition for withdrawn
 * capabilities (src/routes/v1/refuse-unavailable.ts, and the 26 Jul ruling
 * recorded on the seven vacuous /v1/analysis/* routes): a 404 is
 * indistinguishable from a typo and destroys the evidence. A typed 501 says the
 * capability existed, was withdrawn, and why. It also keeps the path mounted so
 * caller telemetry can establish who — if anyone — was relying on it. That
 * matters more here than usual: the reference sweep that cleared this route was
 * REPO-SCOPED, so it can prove UI and CEE do not call it but cannot prove that no
 * external or manual caller exists. Telemetry answers that; a 404 would delete
 * the question.
 *
 * The refusal is unconditional and precedes request validation AND the demo-mode
 * short-circuit. Both removals are deliberate: no input is "valid" for a
 * capability that does not exist, and a demo payload of a withdrawn capability is
 * still a fabricated counterfactual — the demo twin hard-coded its own
 * revenue/LTV figures behind the same model card and confidence badge.
 *
 * The compute internals were deleted with the route. They were module-local and
 * never exported, so nothing outside this file could consume them. Shared helpers
 * it used — buildModelCard, calculateConfidence, buildExplainDelta,
 * checkIdentifiability, enforceComputeBudget — are untouched and still used by
 * live routes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { refuseUnavailable, PLACEHOLDER_ESTIMATE_REASON, WITHDRAWN_ROUTE_OPTIONS } from './refuse-unavailable.js';

export async function registerCounterfactualRoute(app: FastifyInstance) {
  app.post('/v1/counterfactual', WITHDRAWN_ROUTE_OPTIONS, async (req: FastifyRequest, reply: FastifyReply) =>
    refuseUnavailable(req, reply, '/v1/counterfactual', PLACEHOLDER_ESTIMATE_REASON)
  );
}
