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
 * ⚠ THE FAMILY MAP IS A HAND-MAINTAINED LIST, AND THAT IS DELIBERATE — BUT ITS
 * ERROR DIRECTION IS NOT NEUTRAL. `classifyUnitCompatibility` FAILS CLOSED: a
 * token absent from every family reconciles only with a byte-identical token,
 * and mismatches with anything else. So a SHORT list costs COVERAGE (an honest
 * refusal where a rescale would in fact have been fine) and can never cost
 * TRUTH (it cannot bless a mismatch it does not know about). Per the estate's
 * derived-guard doctrine, a derived predicate can prove agreement but never
 * completeness, so `constraint-units.corpus.test.ts` carries a HAND-WRITTEN
 * corpus of the units actually seen on the wire — that is the guard that
 * notices the list is short, and it is not derived from the list.
 */

/**
 * Percent unit vocabulary — the SINGLE SOURCE for both `isPercentUnit`
 * (house doctrine: '%' always normalises against 100) and the `percent`
 * family below. Re-listing these tokens anywhere else re-opens the drift this
 * constant closes.
 */
export const PERCENT_UNIT_TOKENS: readonly string[] = ['%', 'percent', 'pct', 'percentage'];

/** Coarse quantity kinds a declared unit token can name. */
export type UnitFamily = 'percent' | 'fraction' | 'count' | 'currency' | 'duration';

/**
 * Canonical family → tokens. Populated from what PRODUCERS were measured to
 * emit plus the vocabulary the types themselves document, NOT from what a unit
 * "ought to" be:
 *   - constraint `unit`, real captures: 'count', 'fraction'
 *   - constraint `unit`, `types/engine-v3.ts:383` doc: 'months', 'days', '%', 'currency'
 *   - node `observed_state.unit`, real captures: '%', '£'
 * Everything else here is a conservative sibling of a measured token.
 */
const UNIT_FAMILY_TOKENS: Readonly<Record<UnitFamily, readonly string[]>> = {
  percent: PERCENT_UNIT_TOKENS,
  fraction: ['fraction', 'fractional', 'ratio', 'proportion', 'probability'],
  count: ['count', 'counts', 'number', 'people', 'headcount', 'employees', 'fte', 'units', 'items'],
  currency: ['currency', 'money', '£', '$', '€', 'gbp', 'usd', 'eur', 'pounds', 'dollars', 'euros'],
  duration: ['months', 'month', 'days', 'day', 'weeks', 'week', 'years', 'year', 'quarters', 'quarter'],
};

/** Reverse index, DERIVED from `UNIT_FAMILY_TOKENS` (never a second hand-list). */
const FAMILY_BY_TOKEN: ReadonlyMap<string, UnitFamily> = (() => {
  const m = new Map<string, UnitFamily>();
  for (const family of Object.keys(UNIT_FAMILY_TOKENS) as UnitFamily[]) {
    for (const token of UNIT_FAMILY_TOKENS[family]) m.set(token, family);
  }
  return m;
})();

/** Every family key, exported so a corpus/union test can iterate the map itself. */
export const UNIT_FAMILIES: readonly UnitFamily[] = Object.keys(UNIT_FAMILY_TOKENS) as UnitFamily[];

/** The tokens declared for one family (read-only view, for tests + callers). */
export function unitTokensForFamily(family: UnitFamily): readonly string[] {
  return UNIT_FAMILY_TOKENS[family];
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

/** The family a declared unit belongs to, or `undefined` if none claims it. */
export function unitFamily(unit: unknown): UnitFamily | undefined {
  const u = canonicaliseUnit(unit);
  return u === undefined ? undefined : FAMILY_BY_TOKEN.get(u);
}

/**
 * Verdict on a (constraint unit, scale unit) pair.
 *
 * - `undeclared`  — at least one side declared no unit. NOTHING IS CLAIMED:
 *   this is not a reconciliation and not a mismatch. It must never gate, or
 *   the guard would fire on every constraint in a graph that carries no units
 *   at all (the witnessed pricing scenario: `out_gross_margin` has no
 *   `observed_state` whatsoever).
 * - `reconciled`  — the two name the same quantity kind, so dividing the
 *   threshold by that scale is meaningful.
 * - `mismatched`  — the two name different quantity kinds, OR at least one is
 *   outside every declared family and they are not byte-identical. FAIL-CLOSED
 *   (see the module header).
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
  const fa = FAMILY_BY_TOKEN.get(a);
  const fb = FAMILY_BY_TOKEN.get(b);
  if (fa !== undefined && fa === fb) return 'reconciled';
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
