/**
 * `defaulted_assumptions[].source === 'value_not_stated'` — the disclosure arm
 * for a factor value OLUMI ITSELF SUPPLIED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * `buildDefaultedAssumptions` admits a factor row on ONE predicate:
 * `value_defaulted === true`. That flag is *ISL's* — it means ISL substituted a
 * default because no value arrived (`types/engine-v3.ts:2552-2557`). It is
 * therefore STRUCTURALLY BLIND to the case this test is about: CEE's repair
 * sweep invents a value UPSTREAM of ISL, so the number reaches ISL as a
 * perfectly ordinary `observed_state.value` and ISL never marks it. The group
 * the UI renders as "What Olumi assumed" then comes back EMPTY on exactly the
 * runs where Olumi assumed the most.
 *
 * What DOES cross the wire on those runs is the provenance stamp: CEE writes
 * `observed_state.source`, ISL echoes it back on `FactorSensitivityV2` as
 * `value_source`, and PLoT already carries it verbatim
 * (`routes/v2/run.ts:1111`, `lib/factor-influence.ts:1039`). This spec pins the
 * disclosure that reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⭐ THE ACCEPTANCE CONDITION IS THE OPPOSITE-DIRECTION TWIN
 * ─────────────────────────────────────────────────────────────────────────────
 * A change that discloses on EVERYTHING would read as "working" to every test
 * that only checks the disclosing direction, while destroying the product's
 * core output. So every disclosing case below has a twin that must NOT
 * disclose, and the twin block additionally pins that the run's LEADER CLAIM —
 * headline band, gap and win probabilities — is byte-identical to the
 * disclosing run's. The percentage a user's own figures earned must still be
 * stated at full confidence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAIL-CLOSED, AND THE MIRROR'S DIRECTION IS DECLARED
 * ─────────────────────────────────────────────────────────────────────────────
 * The model-owned literal set (`cee_inference` / `inferred` / `cee_repair`) is
 * a hand-written mirror of the classifier that owns it in the consumer
 * (`DecisionGuideAI src/canvas/domain/valueProvenance.ts` `SOURCE_CLASSES`,
 * kind `'ai'`, read at UI `4f3d85a0c695263f`) — CLAUDE.md trap 12. It cannot be
 * imported across repos, so the disposal is: UNKNOWN AND ABSENT LITERALS MAKE
 * NO CLAIM, exactly as `classifyValueProvenance` returns `null` rather than
 * guessing. The mirror can therefore only ever go SHORT — a new model-owned
 * literal nobody adds here UNDER-discloses; it can never fabricate a
 * disclosure against a value the user actually supplied. The set is pinned
 * below with a contrast control in the same run, so a change to it REDs.
 *
 * Rows are bound BY IDENTITY (`factor_id`), never by a value predicate another
 * row could satisfy (CLAUDE.md trap 19).
 */

import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

/** The one option_comparison used by every case — the leader claim must not move. */
const OPTIONS = [
  { option_id: 'opt_a', option_label: 'Keep price', id: 'opt_a', label: 'Keep price', win_probability: 0.64 },
  { option_id: 'opt_b', option_label: 'Raise price', id: 'opt_b', label: 'Raise price', win_probability: 0.36 },
];

function makeInput(factorSensitivity: unknown[]): BriefAssemblyInput {
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: JSON.parse(JSON.stringify(OPTIONS)) as any[],
    // `is_robust: true` deliberately — the twin below must pin the STRONGEST
    // confident claim this producer can make ('clearly_ahead', ungated), not a
    // claim already downgraded for an unrelated reason. Derived from
    // isRobustnessEstablished (decision-brief.ts:603-608), not assumed.
    robustness: { level: 'high', is_robust: true, fragile_edges: [], robust_edges: [] } as any,
    factor_sensitivity: factorSensitivity as any,
    meta: { seed_used: '42' },
  };
}

function rows(brief: { defaulted_assumptions?: Array<Record<string, unknown>> } | null) {
  expect(brief, 'assembleBrief returned a brief').not.toBeNull();
  return (brief!.defaulted_assumptions ?? []) as Array<Record<string, unknown>>;
}

/** Identity binding — one row for this factor_id, or fail naming the id. */
function rowById(brief: any, id: string) {
  const matching = rows(brief).filter((r) => r.factor_id === id);
  expect(matching, `exactly one defaulted_assumptions row for factor_id=${id}`).toHaveLength(1);
  return matching[0];
}

const MODEL_OWNED_LITERALS = ['cee_inference', 'inferred', 'cee_repair'] as const;

/**
 * Literals that must NOT disclose. `brief_extraction`/`explicit` are the user's
 * OWN brief — the copy says "it did not come from you or your brief", so a
 * brief-extracted value is not Olumi's assumption and disclosing it would be a
 * false claim about the user's input.
 */
const NOT_MODEL_OWNED_LITERALS = [
  'user_confirmed',
  'user_override',
  'user',
  'user_edited',
  'user_calibration',
  'user_assumption',
  'brief_extraction',
  'explicit',
  'panel_elicited',
] as const;

describe("defaulted_assumptions — 'value_not_stated' discloses a value Olumi supplied", () => {
  it('emits a value_not_stated row for a model-owned value_source, with the producer-owned copy', () => {
    const brief = assembleBrief(
      makeInput([
        { factor_id: 'fac_market_size', factor_label: 'Market size', elasticity: 0.5, value_source: 'cee_inference' },
      ]),
    );

    const row = rowById(brief, 'fac_market_size');
    expect(row.source).toBe('value_not_stated');
    expect(row.factor_label).toBe('Market size');
    expect(row.doctrine).toBe('provisional_doctrine_v0');
    expect(row.note).toBe(
      'Olumi supplied the starting value for "Market size" — it did not come from you or your brief. ' +
        'Give it a figure or a range and this comparison will rest on your number instead.',
    );
    // Run-level-only key must not appear on a factor-scoped row.
    expect(row.code).toBeUndefined();
  });

  it.each(MODEL_OWNED_LITERALS)('discloses on the model-owned literal %s', (literal) => {
    const brief = assembleBrief(
      makeInput([{ factor_id: 'fac_x', factor_label: 'Churn', elasticity: 0.2, value_source: literal }]),
    );
    expect(rowById(brief, 'fac_x').source).toBe('value_not_stated');
  });

  it('falls the label back to the id when unlabelled, exactly as the value_defaulted arm does', () => {
    const brief = assembleBrief(
      makeInput([{ factor_id: 'fac_no_label', elasticity: 0.1, value_source: 'cee_repair' }]),
    );
    const row = rowById(brief, 'fac_no_label');
    expect(row.factor_label).toBe('fac_no_label');
    expect(row.note).toContain('"fac_no_label"');
  });
});

describe('⭐ OPPOSITE-DIRECTION TWIN — a ranking the user\'s own figures earned still states itself confidently', () => {
  it.each(NOT_MODEL_OWNED_LITERALS)('makes NO disclosure for %s', (literal) => {
    const brief = assembleBrief(
      makeInput([{ factor_id: 'fac_x', factor_label: 'Churn', elasticity: 0.2, value_source: literal }]),
    );
    expect(rows(brief)).toHaveLength(0);
  });

  it('makes NO disclosure for an UNKNOWN literal — fail-closed, never a guessed class', () => {
    const brief = assembleBrief(
      makeInput([
        { factor_id: 'fac_x', factor_label: 'Churn', elasticity: 0.2, value_source: 'some_future_literal' },
      ]),
    );
    expect(rows(brief)).toHaveLength(0);
  });

  it('makes NO disclosure when value_source is ABSENT — absence is not evidence of invention', () => {
    const brief = assembleBrief(makeInput([{ factor_id: 'fac_x', factor_label: 'Churn', elasticity: 0.2 }]));
    expect(rows(brief)).toHaveLength(0);
  });

  it('leaves the LEADER CLAIM byte-identical between an all-user run and an all-model run', () => {
    const userRun = assembleBrief(
      makeInput([
        { factor_id: 'fac_a', factor_label: 'Market size', elasticity: 0.5, value_source: 'user_override' },
        { factor_id: 'fac_b', factor_label: 'Churn', elasticity: 0.3, value_source: 'brief_extraction' },
      ]),
    )!;
    const modelRun = assembleBrief(
      makeInput([
        { factor_id: 'fac_a', factor_label: 'Market size', elasticity: 0.5, value_source: 'cee_inference' },
        { factor_id: 'fac_b', factor_label: 'Churn', elasticity: 0.3, value_source: 'cee_inference' },
      ]),
    )!;

    // The disclosure differs — that is the whole point of the change.
    expect(rows(userRun)).toHaveLength(0);
    expect(rows(modelRun).map((r) => r.factor_id)).toEqual(['fac_a', 'fac_b']);

    // ⭐ And NOTHING about the confident claim moves, in EITHER direction.
    const userHeadline = (userRun as any).headline_banded;
    const modelHeadline = (modelRun as any).headline_banded;
    expect(userHeadline).toBeDefined();
    expect(userHeadline).toEqual(modelHeadline);
    expect(userHeadline.band).toBe('clearly_ahead');
    expect(userHeadline.text).toBe('Keep price is clearly ahead.');
    expect(userHeadline.robustness_gated).toBe(false);
    expect(userHeadline.win_probability_gap).toBeCloseTo(0.28, 10);

    // The percentage itself is untouched on both arms.
    expect(userRun.options.map((o) => o.win_probability)).toEqual([0.64, 0.36]);
    expect(modelRun.options.map((o) => o.win_probability)).toEqual([0.64, 0.36]);
    expect(userRun.robustness).toEqual(modelRun.robustness);
    expect((userRun as any).robustness_caveat).toEqual((modelRun as any).robustness_caveat);
  });
});

describe('defaulted_assumptions — the existing arms are unchanged', () => {
  it('keeps a value_defaulted row on its own source and its EXACT existing copy', () => {
    const brief = assembleBrief(
      makeInput([
        { factor_id: 'fac_market_size', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
      ]),
    );
    const row = rowById(brief, 'fac_market_size');
    expect(row.source).toBe('value_defaulted');
    expect(row.note).toBe(
      'No starting value was provided for "Market Size" — the analysis used a default. ' +
        'Setting a real value or range would make this result more trustworthy.',
    );
  });

  it('emits ONE row, on the ISL arm, when a factor is BOTH value_defaulted and model-sourced', () => {
    const brief = assembleBrief(
      makeInput([
        {
          factor_id: 'fac_both',
          factor_label: 'Both',
          elasticity: 0.5,
          value_defaulted: true,
          value_source: 'cee_inference',
        },
      ]),
    );
    expect(rows(brief)).toHaveLength(1);
    expect(rowById(brief, 'fac_both').source).toBe('value_defaulted');
  });

  it('still excludes an intervention-pinned lever from the NEW arm (same A1b predicate)', () => {
    const brief = assembleBrief(
      makeInput([
        {
          factor_id: 'fac_lever',
          factor_label: 'Price',
          elasticity: 0.5,
          value_source: 'cee_inference',
          zero_reason: 'intervention_override',
        },
        { factor_id: 'fac_free', factor_label: 'Churn', elasticity: 0.4, value_source: 'cee_inference' },
      ]),
    );
    expect(rows(brief).map((r) => r.factor_id)).toEqual(['fac_free']);
  });

  it('sorts the new arm bytewise by factor_id and keeps the 10-row cap', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      factor_id: `fac_${String(i).padStart(2, '0')}`,
      factor_label: `F${i}`,
      elasticity: 0.1,
      value_source: 'inferred',
    }));
    // Shuffle so a passing sort assertion cannot be an artefact of input order.
    const brief = assembleBrief(makeInput([...many].reverse()));
    const ids = rows(brief).map((r) => r.factor_id);
    expect(ids).toHaveLength(10);
    expect(ids).toEqual([...ids].sort());
    expect(ids[0]).toBe('fac_00');
  });
});
