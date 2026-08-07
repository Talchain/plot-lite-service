/**
 * Constraint / scale UNIT compatibility (ROADMAP — the goal-fit unit collision).
 *
 * WITNESSED DEFECT, inverted from a real staging capture, not from a fixture
 * (`PHASE0-EVIDENCE-2026-07-28/l60-artefacts/scenario-people.json` +
 * `runfact-7fe412ba-run3.json`, decision `7fe412ba`, run 3):
 *
 *   goal_constraints[0] = { node_id: 'risk_ae_attrition', operator: '<=',
 *                           value: 2, unit: 'count',
 *                           label: 'Account executives lost' }
 *   nodes['risk_ae_attrition'].observed_state
 *                         = { cap: 100, unit: '%', value: 0.2, raw_value: 20 }
 *
 * `deriveRange` took Priority 0 (`observed_state.cap`) and produced
 * `[0, 100] source 'explicit_cap'`; `normaliseValue(2, [0,100])` produced
 * **0.02**. The user asked for "lose at most 2 account executives" — a COUNT of
 * people — and the wire carried "attrition at or below 2%", a target about a
 * different quantity and roughly ten times stricter. The captured result:
 * `probability: 0` on every option with
 * `scale_provenance: { source: 'explicit_cap', range_unified: true,
 * decision_grade: TRUE }` — the product's highest-confidence badge on a number
 * built from a unit error.
 *
 * THE INVARIANT THIS MODULE SERVES: a constraint threshold must not be
 * normalised against a scale whose unit it does not share. When the two units
 * cannot be reconciled the honest outcomes are CONVERT (if a defensible
 * conversion exists) or REFUSE with a typed reason — never a silent rescale.
 *
 * ⚠ WHY THIS MODULE ONLY REFUSES, AND NEVER CONVERTS. A conversion needs the
 * producer's declared semantics for BOTH units. PLoT has none: `unit` is a
 * free-text `string` on `RawGoalConstraint` and on `observed_state`, minted
 * upstream with no enum, no schema membership check and no attestation
 * (`types/engine-v3.ts` says as much for `observed_state.source`). Inventing a
 * factor — even one as apparently safe as fraction×100 = percent — would be a
 * MANUFACTURED ATTESTATION, the same fabrication class the estate's frame
 * doctrine exists to kill ("a defaulted frame is a manufactured attestation").
 * A conversion becomes defensible the day a producer attests the pair; until
 * then refusing is the only honest disposal, and it costs coverage rather than
 * truth.
 *
 * ⚠ COMPATIBILITY KEYS ON THE **SCALE**, NEVER ON THE DIMENSION — AND THE TWO
 * ARE DIFFERENT QUESTIONS. `unitDimension` answers *"what quantity does this
 * token measure?"* (money, time, headcount). `unitScale` answers *"which unit,
 * magnitude included?"* (`£` vs `$`; `months` vs `weeks`). Only the second
 * licenses dividing a threshold by a scale. An earlier revision of this module
 * grouped tokens by DIMENSION and treated same-dimension as reconciled; that
 * blessed `months` against a `weeks` cap — *"within 6 months"* normalised to
 * **0.25** where the truth is 1.083, a 4.33× stricter target, carrying
 * `decision_grade: true`. That is the very defect this module exists to refuse,
 * re-opened one level up. The two concepts are now named apart and only
 * `UnitScale` gates; `constraint-unit-mismatch.test.ts` carries a DERIVED guard
 * asserting that every pair of distinct scales sharing a dimension classifies
 * `mismatched`, so collapsing them again REDs by name.
 *
 * ⚠ THE SCALE TABLE IS A HAND-MAINTAINED LIST, AND THAT IS DELIBERATE — BUT ITS
 * ERROR DIRECTION IS NOT NEUTRAL, AND IT IS NOT NEUTRAL IN ONE DIRECTION ONLY.
 * `classifyUnitCompatibility` FAILS CLOSED on tokens it does not know: a token
 * absent from every group reconciles only with a byte-identical token, and
 * mismatches with anything else. So a **SHORT** list costs COVERAGE (an honest
 * refusal where a rescale would in fact have been fine) and cannot cost truth.
 * **BUT A COARSE LIST COSTS TRUTH**, because a group is an assertion that its
 * members are interchangeable — and a wrong one is believed, not refused. This
 * module previously claimed a hand list "can never cost TRUTH (it cannot bless a
 * mismatch it does not know about)". That is true of SHORTNESS and FALSE OF
 * COARSENESS: the old map did not merely fail to know about `months`/`weeks`,
 * it knew about the pair and blessed it. **A fail-closed guard is only as honest
 * as the GRANULARITY of its categories** — every token added to an existing
 * group is a claim that it is the same unit as its group-mates, and that claim
 * carries the truth risk that membership itself cannot fail closed against.
 *
 * Hence TWO guards, neither superseding the other (the estate's derived-guard
 * doctrine: derivation proves agreement and can never prove completeness):
 *   - DERIVED, in `constraint-unit-mismatch.test.ts` — the predicate behaves,
 *     and same-dimension/different-scale stays `mismatched`. Catches consumers
 *     and the two concepts drifting back together. Blind to a short list.
 *   - HAND-WRITTEN, in `constraint-units.corpus.test.ts` — the tokens actually
 *     seen on the wire, and pair VERDICTS written from what the tokens mean and
 *     not read back off this table. That is the only guard that can notice the
 *     table is short, or that a group is wrong.
 */

/**
 * Percent unit vocabulary — the SINGLE SOURCE for both `isPercentUnit`
 * (house doctrine: '%' always normalises against 100) and the `percent` scale
 * group below. Re-listing these tokens anywhere else re-opens the drift this
 * constant closes.
 */
export const PERCENT_UNIT_TOKENS: readonly string[] = ['%', 'percent', 'pct', 'percentage'];

/**
 * The QUANTITY a declared unit token measures. Informational only — this is
 * explicitly NOT what compatibility keys on (see the module header).
 */
export type UnitDimension = 'percent' | 'fraction' | 'count' | 'currency' | 'duration';

/**
 * The UNIT itself, magnitude included. Two tokens share a scale only when they
 * are interchangeable with NO conversion factor. **This is what
 * `classifyUnitCompatibility` keys on.**
 */
export type UnitScale =
  | 'percent'
  | 'fraction'
  | 'count'
  | 'currency_unspecified'
  | 'currency_gbp'
  | 'currency_usd'
  | 'currency_eur'
  | 'duration_years'
  | 'duration_quarters'
  | 'duration_months'
  | 'duration_weeks'
  | 'duration_days'
  | 'duration_hours'
  | 'duration_minutes';

/**
 * THE SINGLE TABLE. Every index below is DERIVED from it — there is no second
 * hand-maintained list to drift.
 *
 * Populated from what PRODUCERS were measured to emit plus the vocabulary the
 * types themselves document, NOT from what a unit "ought to" be:
 *   - constraint `unit`, real captures: 'count', 'fraction', '£'
 *   - constraint `unit`, `types/engine-v3.ts:383` doc: 'months', 'days', '%', 'currency'
 *   - node `observed_state.unit`, real captures: '%', '£'
 *   - CEE, measured read-only at `staging` 8278efc2 (there is no enum on `unit`
 *     anywhere in CEE, so this is a floor and not a bound): 'hours', 'hour',
 *     'minutes'
 * Everything else here is a conservative sibling of a measured/documented token.
 *
 * ⚠ MEMBERSHIP IS A TRUTH CLAIM, NOT A COVERAGE CONVENIENCE. Putting a token in
 * a group asserts it needs NO conversion factor against its group-mates. Adding
 * a NEW GROUP is safe in the fail-closed direction (an unknown token already
 * mismatches everything but itself, so a new group can only ever ADD
 * reconciliation between its own aliases). Adding a token to an EXISTING group
 * is the dangerous edit, and is what produced the `months`/`weeks` defect.
 */
const UNIT_SCALE_TABLE: readonly {
  scale: UnitScale;
  dimension: UnitDimension;
  tokens: readonly string[];
}[] = [
  { scale: 'percent', dimension: 'percent', tokens: PERCENT_UNIT_TOKENS },
  {
    scale: 'fraction',
    dimension: 'fraction',
    tokens: ['fraction', 'fractional', 'ratio', 'proportion', 'probability'],
  },
  {
    scale: 'count',
    dimension: 'count',
    tokens: ['count', 'counts', 'number', 'people', 'headcount', 'employees', 'fte', 'units', 'items'],
  },
  // ⚠ `currency`/`money` name the DIMENSION and no scale: a threshold declared
  // "currency" could be dollars, and dividing it by a `£` cap is an unattested
  // FX assumption — the same dimension-for-unit substitution this module
  // refuses everywhere else. They therefore form their own group and reconcile
  // only with each other, never with a NAMED currency. (Cost is coverage only,
  // and speculative: `currency` is a PLoT doc-string token, not one any
  // measured CEE emission carries.)
  { scale: 'currency_unspecified', dimension: 'currency', tokens: ['currency', 'money'] },
  { scale: 'currency_gbp', dimension: 'currency', tokens: ['£', 'gbp', 'pounds'] },
  { scale: 'currency_usd', dimension: 'currency', tokens: ['$', 'usd', 'dollars'] },
  { scale: 'currency_eur', dimension: 'currency', tokens: ['€', 'eur', 'euros'] },
  { scale: 'duration_years', dimension: 'duration', tokens: ['years', 'year'] },
  { scale: 'duration_quarters', dimension: 'duration', tokens: ['quarters', 'quarter'] },
  { scale: 'duration_months', dimension: 'duration', tokens: ['months', 'month'] },
  { scale: 'duration_weeks', dimension: 'duration', tokens: ['weeks', 'week'] },
  { scale: 'duration_days', dimension: 'duration', tokens: ['days', 'day'] },
  { scale: 'duration_hours', dimension: 'duration', tokens: ['hours', 'hour'] },
  { scale: 'duration_minutes', dimension: 'duration', tokens: ['minutes', 'minute'] },
];

/** Reverse index, DERIVED from `UNIT_SCALE_TABLE` (never a second hand-list). */
const SCALE_BY_TOKEN: ReadonlyMap<string, UnitScale> = (() => {
  const m = new Map<string, UnitScale>();
  for (const row of UNIT_SCALE_TABLE) for (const token of row.tokens) m.set(token, row.scale);
  return m;
})();

/** Scale → dimension, DERIVED from the same table. */
const DIMENSION_BY_SCALE: ReadonlyMap<UnitScale, UnitDimension> = new Map(
  UNIT_SCALE_TABLE.map((r) => [r.scale, r.dimension] as const),
);

/** Every declared scale, exported so a derived/corpus test can iterate the table itself. */
export const UNIT_SCALES: readonly UnitScale[] = UNIT_SCALE_TABLE.map((r) => r.scale);

/** The tokens declared for one scale (read-only view, for tests + callers). */
export function unitTokensForScale(scale: UnitScale): readonly string[] {
  return UNIT_SCALE_TABLE.find((r) => r.scale === scale)?.tokens ?? [];
}

/** The dimension a scale measures (read-only view, for tests + callers). */
export function dimensionOfScale(scale: UnitScale): UnitDimension | undefined {
  return DIMENSION_BY_SCALE.get(scale);
}

/**
 * Canonical form of a declared unit token: trimmed + lower-cased. An absent,
 * non-string or empty unit canonicalises to `undefined` — "nothing was
 * declared", which is NOT the same claim as "declared and unrecognised".
 */
export function canonicaliseUnit(unit: unknown): string | undefined {
  if (typeof unit !== 'string') return undefined;
  const u = unit.trim().toLowerCase();
  return u.length > 0 ? u : undefined;
}

/**
 * The SCALE a declared unit belongs to, or `undefined` if none claims it.
 * **This is the identity compatibility is decided on.**
 */
export function unitScale(unit: unknown): UnitScale | undefined {
  const u = canonicaliseUnit(unit);
  return u === undefined ? undefined : SCALE_BY_TOKEN.get(u);
}

/**
 * The DIMENSION a declared unit measures, or `undefined` if none claims it.
 *
 * ⚠ INFORMATIONAL ONLY. Two tokens sharing a dimension are NOT interchangeable
 * (`months` and `weeks` share one). Never gate on this — gate on `unitScale`.
 */
export function unitDimension(unit: unknown): UnitDimension | undefined {
  const s = unitScale(unit);
  return s === undefined ? undefined : DIMENSION_BY_SCALE.get(s);
}

/**
 * Verdict on a (constraint unit, scale unit) pair.
 *
 * - `undeclared`  — at least one side declared no unit. NOTHING IS CLAIMED:
 *   this is not a reconciliation and not a mismatch. It must never gate, or
 *   the guard would fire on every constraint in a graph that carries no units
 *   at all (the witnessed pricing scenario: `out_gross_margin` has no
 *   `observed_state` whatsoever).
 * - `reconciled`  — the two name the SAME UNIT (same scale group, or literally
 *   the same token), so dividing the threshold by that scale is meaningful with
 *   no conversion factor.
 * - `mismatched`  — the two name different units — including two units of the
 *   SAME DIMENSION at different magnitudes (`months` vs `weeks`, `$` vs `£`) —
 *   OR at least one is outside every declared scale and they are not
 *   byte-identical. FAIL-CLOSED (see the module header).
 */
export type UnitCompatibility = 'undeclared' | 'reconciled' | 'mismatched';

export function classifyUnitCompatibility(
  constraintUnit: unknown,
  scaleUnit: unknown,
): UnitCompatibility {
  const a = canonicaliseUnit(constraintUnit);
  const b = canonicaliseUnit(scaleUnit);
  if (a === undefined || b === undefined) return 'undeclared';
  if (a === b) return 'reconciled';
  // ⚠ SCALE, NOT DIMENSION. Comparing dimensions here would bless `months`
  // against a `weeks` cap — a 4.33× rescale wearing a decision-grade badge.
  // The derived same-dimension/different-scale guard in
  // `constraint-unit-mismatch.test.ts` REDs if this is ever loosened back.
  const sa = SCALE_BY_TOKEN.get(a);
  const sb = SCALE_BY_TOKEN.get(b);
  if (sa !== undefined && sa === sb) return 'reconciled';
  return 'mismatched';
}

/**
 * True when a constraint's unit is the unit of the scale it is about to be
 * normalised against. `undeclared` counts as reconcilable — see above: absence
 * of a declaration is not evidence of a collision.
 */
export function unitsReconcilable(constraintUnit: unknown, scaleUnit: unknown): boolean {
  return classifyUnitCompatibility(constraintUnit, scaleUnit) !== 'mismatched';
}

/**
 * The typed reason a constraint's threshold could not be normalised: the two
 * declared units name different quantity kinds. Carried on the normalisation
 * diagnostic, projected onto `scale_provenance`, and read by the reliability
 * gate — one derivation, several consumers (never re-derived downstream).
 */
export interface ConstraintUnitMismatch {
  /** The constraint's own declared unit, canonicalised. */
  constraint_unit: string;
  /** The declared unit of the SCALE the ladder resolved, canonicalised. */
  scale_unit: string;
}
