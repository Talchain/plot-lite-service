/**
 * Importance authority — which quantity `/v2/run` publishes as "what matters
 * most", and who is allowed to hold rank 1.
 *
 * ## The problem this module fixes (lane PLoT importance-authority, 25 Jul 2026)
 *
 * `/v2/run` publishes several "what matters most" surfaces in ONE body, and
 * before this module they disagreed with each other on the live wire
 * (plot-lite-service-staging build `1dd45b6`, real request, ISL in the loop):
 *
 * | surface | named #1 | applies the lever doctrine? |
 * |---|---|---|
 * | `factor_sensitivity[].importance_rank` = 1 | `fac_tech_lead` (a lever) | NO |
 * | `factor_sensitivity[].driver_label` = `'biggest'` | `fac_tech_lead` | NO |
 * | `decision_brief.top_drivers[0]` | `fac_hiring_cost` | yes |
 * | `m1_coaching.evidence_gaps[0]` | `fac_hiring_cost` | yes |
 * | `decision_brief.warnings[DOMINANT_FACTOR]` | `fac_hiring_cost` | yes |
 * | ISL's own `importance_rank` = 1 | `fac_hiring_cost` | n/a |
 *
 * `fac_tech_lead` is an option-pinned LEVER. The same response publishes it at
 * `sensitivity_score: 0`, `elasticity: 0`, `value_of_information: 0`,
 * `zero_reason: 'intervention_override'` — PLoT deliberately zeroes all of those
 * (`LEVER_SUPPRESSION_FIELDS`) and deliberately withholds its EVPI, with the
 * stated reason that emitting it would *"rank the lever as an investigation
 * priority"*. Crowning that same factor `importance_rank: 1` and `'biggest'` is
 * a direct contradiction of PLoT's own ratified doctrine, stated plainly at
 * `src/coaching/evidence-gaps.ts`:
 *
 * > *"Intervention-target factors are decision levers (set directly by options),
 * > not background uncertainties to validate, so they are excluded BEFORE the
 * > rank/quartile gate. Applying eligibility first prevents levers from consuming
 * > the top-k slots and hiding valid non-lever factors that ranked below them in
 * > the enriched importance order."*
 *
 * ## What this module does NOT do
 *
 * **It is not a graph-vs-ISL precedence flip.** Graph-derived factor sensitivity
 * stays PRIMARY (`src/routes/v2/run.ts`, commit `f6f7255`). `influence_score` and
 * `influence_rank` keep their exact graph-derived values under their own,
 * correct names — a lever still tops `influence_rank`, because it genuinely does
 * top the structural influence order. Only the ORDERING published as
 * `importance_rank`, and eligibility for the set-aware `'biggest'` crown, become
 * lever-aware. Both are *importance* claims; `influence_*` is a *structure*
 * measurement.
 */

import { isOptionControlledLever } from './intervention-override.js';

/**
 * Which authority produced the row's `importance_rank`, disclosed on every
 * `factor_sensitivity` entry so a consumer can never again be unable to tell.
 *
 * - `'graph_structural'` — the rank orders PLoT's own graph path-analysis
 *   influence (`computeFactorSensitivityFromGraph`). This is the live default:
 *   graph-derived factor sensitivity is PRIMARY.
 * - `'isl_uncertainty'` — the graph path returned nothing and the ISL fallback
 *   fired, so the rank is ISL's own Monte-Carlo uncertainty-importance ordering,
 *   passed through verbatim.
 *
 * In BOTH cases option-controlled levers are ordered last — see
 * `applyLeverAwareImportanceOrder`.
 */
export type ImportanceBasis = 'graph_structural' | 'isl_uncertainty';

export const IMPORTANCE_BASIS_GRAPH: ImportanceBasis = 'graph_structural';
export const IMPORTANCE_BASIS_ISL: ImportanceBasis = 'isl_uncertainty';

/** Minimal shape the ordering reads. Matches `FactorSensitivityResultV3`. */
interface RankableFactor {
  factor_id?: string;
  node_id?: string;
  zero_reason?: string | null;
  importance_rank?: number;
  influence_score?: number | null;
}

/**
 * Re-derive `importance_rank` so that every non-lever outranks every lever,
 * and emit the array in that order.
 *
 * Relative order WITHIN each partition is preserved exactly as it arrived (the
 * graph influence order on the primary path, ISL's own importance order on the
 * fallback path) — this function only moves levers to the back. The returned
 * array is a new array; entries are mutated in place for `importance_rank` only.
 *
 * NO-OP (returns the input array untouched, byte-identically) when the partition
 * is degenerate — zero levers, or zero non-levers — because there is then no
 * lever displacing a genuine uncertainty driver and nothing to fix. That keeps
 * the change surgically scoped to the exact case that produces the harm.
 *
 * The emitted ARRAY ORDER follows `importance_rank` after this pass, so a
 * downstream `factor_sensitivity[0]` reader (a common "top driver" idiom) gets
 * the same answer as an `importance_rank === 1` reader. `influence_rank` is a
 * named field and is NOT re-derived, so it still carries the graph order.
 */
export function applyLeverAwareImportanceOrder<T extends RankableFactor>(
  factors: T[],
  structuralLeverIds: ReadonlySet<string>,
): T[] {
  const levers: T[] = [];
  const nonLevers: T[] = [];
  for (const f of factors) {
    (isOptionControlledLever(f, structuralLeverIds) ? levers : nonLevers).push(f);
  }
  // Degenerate partition — nothing is being displaced. Return the SAME array
  // reference so the no-op is provably byte-identical.
  if (levers.length === 0 || nonLevers.length === 0) {
    return factors;
  }
  const ordered = [...nonLevers, ...levers];
  for (let i = 0; i < ordered.length; i++) {
    ordered[i].importance_rank = i + 1;
  }
  return ordered;
}

/**
 * ── NOT DONE HERE, ON PURPOSE: the `driver_label: 'biggest'` crown ──
 *
 * `driver_label`'s rank-1 `'biggest'` band (`src/lib/driver-label.ts`,
 * Doctrine 039 / D-7) is argmax over `influence_score` and is NOT lever-aware,
 * so on the live wire it lands on the option-pinned lever while
 * `importance_rank: 1` (above) lands on the top genuine uncertainty driver.
 * Those two disagree by design as of this lane. Reasons for leaving it:
 *
 *   1. `'biggest'` is DEFINED as the greatest `influence_score`. Gating it makes
 *      the label contradict the number in its own row (a lever at
 *      influence_score 1.0 labelled 'strong' beneath a 0.497 labelled
 *      'biggest') — trading one incoherence for another.
 *   2. The basis question ("should driver_label rank on influence or on
 *      elasticity/importance?") is ALREADY an open doctrine row owned by
 *      Neil/UI, recorded in driver-label.ts. A producer should not settle it
 *      unilaterally inside an unrelated fix.
 *   3. Blast radius today is zero: censused 25 Jul at the consumer tips
 *      (UI `039f479a`, CEE `f00b8ef6`) — `factor_sensitivity[].driver_label`
 *      has NO read site in either repo.
 *
 * The divergence is PINNED by tests/importance-rank-lever-doctrine.fixture.test.ts
 * so it cannot drift silently while the ruling is pending.
 */
