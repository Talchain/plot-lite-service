/**
 * S1b unit legs — the three #1-surfaces whose divergence the committed golden
 * CANNOT see, proven at the units instead.
 *
 * ## Why this file exists (trap 13, stated the other way round)
 *
 * `tests/driver-order-projection.fixture.test.ts` proves the end-to-end law on
 * the 2026-07-07 capture. On that capture only TWO of the five surfaces
 * disagree with `ranked_factor_ids[0]`; the other three agree — but they agree
 * **by coincidence**, and S1's own residual table says so:
 *
 * | surface | why it agrees on the golden |
 * |---|---|
 * | `dominant_factor` | suppressed by its own `>2` ratio gate — *"ONE NUMBER away from crowning a lever"* (design F-D3) |
 * | `decision_brief.top_drivers[0]` | *"the stamp happens to cover"* — its predicate is stamp-only, which UNDER-covers |
 * | facts-path `importance_rank` | positional `idx + 1`, which *"mirrors the array, so agrees by accident"* |
 *
 * A fixture that agrees by coincidence cannot RED on the defect, and a fix
 * merged against it would be untested by construction (trap 11: no slice merges
 * until reverting the fix turns something RED). Each leg below therefore builds
 * the ONE separating input that breaks the coincidence — the smallest possible
 * perturbation of the real capture, not a hand-invented toy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectDominantFactor } from '../src/trust/factor-dominance.js';
import { assembleBrief } from '../src/assembly/decision-brief.js';
import { mapFactorSensitivityToFactsInput } from '../src/routes/v2/run.js';

const GOLDEN = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      'fixtures',
      'isl-v2-live-20260707',
      'plot-v2-run.golden.json',
    ),
    'utf8',
  ),
);

/** The emitted rows, in the emitted (= canonical) order. Rule S3. */
const GOLDEN_ROWS: any[] = GOLDEN.factor_sensitivity;
const CANONICAL_TOP_ID: string = GOLDEN.driver_order.ranked_factor_ids[0];
const LEVER_IDS: string[] = GOLDEN.driver_order.lever_ids;

// ===========================================================================
// LEG 1 — F-D3: `dominant_factor` is ONE NUMBER away from crowning a lever
// ===========================================================================
describe('F-D3 — dominant_factor must not crown a lever when the ratio gate opens', () => {
  /**
   * The separating input, verbatim from the design's §4.3 F-D3:
   *
   * > drop `fac_dev_headcount.influence_score` from `0.7243` to `0.40`
   * > ⇒ ratio `1 / 0.40 = 2.5 > 2` ⇒ the top-level `dominant_factor` names the
   * > lever.
   *
   * Everything else is the real capture. One number moves.
   */
  const F_D3_ID = 'fac_dev_headcount';
  const F_D3_MUTANT_INFLUENCE = 0.4;

  function fd3Rows(): any[] {
    return GOLDEN_ROWS.map((f) =>
      f.factor_id === F_D3_ID ? { ...f, influence_score: F_D3_MUTANT_INFLUENCE } : { ...f },
    );
  }

  it('positive control: the mutant really does open the >2 ratio gate that the golden closes', () => {
    const rawDesc = (rows: any[]) =>
      [...rows].map((f) => f.influence_score).sort((a, b) => b - a);

    const golden = rawDesc(GOLDEN_ROWS);
    expect(golden[0] / golden[1], 'golden ratio must be <= 2 (gate CLOSED)').toBeLessThanOrEqual(2);

    const mutant = rawDesc(fd3Rows());
    expect(mutant[0] / mutant[1], 'mutant ratio must be > 2 (gate OPEN)').toBeGreaterThan(2);

    // …and the row the raw argmax names is the option-pinned lever.
    const rawArgmax = [...fd3Rows()].sort((a, b) => b.influence_score - a.influence_score)[0];
    expect(LEVER_IDS).toContain(rawArgmax.factor_id);
    expect(rawArgmax.influence_score).toBeGreaterThan(0.5); // clears the influence floor too
  });

  it('positive control: the mutant leaves the CANONICAL order untouched — only the gate moves', () => {
    // The lever partition is structural, not value-based, so demoting one
    // lever's influence cannot reorder the canonical array. If it could, this
    // leg would be testing two changes at once.
    expect(fd3Rows().map((f) => f.factor_id)).toEqual(GOLDEN_ROWS.map((f) => f.factor_id));
  });

  it('⭐ RED before S1b: dominant_factor names ranked_factor_ids[0] or nothing — NEVER a lever', () => {
    const df = detectDominantFactor(fd3Rows());
    if (df !== undefined) {
      expect(df.factor_id, 'dominant_factor must project the canonical #1').toBe(CANONICAL_TOP_ID);
    }
    // The load-bearing half: whatever it does, it may not crown a factor this
    // same response publishes at sensitivity_score 0 / elasticity 0.
    expect(
      df === undefined || !LEVER_IDS.includes(df.factor_id),
      `dominant_factor crowned the option-pinned lever ${df?.factor_id}`,
    ).toBe(true);
  });

  it('the >0.5 influence floor still SUPPRESSES — the projection did not turn the gate off', () => {
    // The canonical #1 on this capture is below the floor, so the honest answer
    // is "no dominant factor", not "the strongest thing I could find".
    const top = GOLDEN_ROWS.find((f) => f.factor_id === CANONICAL_TOP_ID);
    expect(top.influence_score).toBeLessThanOrEqual(0.5);
    expect(detectDominantFactor(fd3Rows())).toBeUndefined();
    expect(detectDominantFactor(GOLDEN_ROWS.map((f) => ({ ...f })))).toBeUndefined();
  });

  it('the gate still FIRES when the canonical #1 genuinely dominates (the fix is not "always undefined")', () => {
    const rows = [
      { factor_id: 'fac_alpha', factor_label: 'Alpha', influence_score: 0.9 },
      { factor_id: 'fac_beta', factor_label: 'Beta', influence_score: 0.3 },
    ];
    expect(detectDominantFactor(rows)?.factor_id).toBe('fac_alpha');
  });

  it('a rival DEMOTED below rank 1 still counts against the ratio — dominance is over the whole set', () => {
    // A lever sits at the BACK of the canonical order but keeps its real
    // structural influence. Comparing rank 1 only against rank 2 would call a
    // 0.6 factor "dominant" while a 1.0 factor sat three rows down.
    const rows = [
      { factor_id: 'fac_alpha', factor_label: 'Alpha', influence_score: 0.6 },
      { factor_id: 'fac_beta', factor_label: 'Beta', influence_score: 0.1 },
      { factor_id: 'fac_lever', factor_label: 'Lever', influence_score: 1.0 },
    ];
    expect(detectDominantFactor(rows)).toBeUndefined();
  });
});

// ===========================================================================
// LEG 2 — `decision_brief.top_drivers[0]`: stamp-only UNDER-covers
// ===========================================================================
describe('decision_brief.top_drivers projects the canonical order, not a stamp-only re-sort', () => {
  /**
   * The separating input is the live `fac_salary_cost` case recorded at
   * `src/lib/intervention-override.ts:9-15`: a lever pinned by a NON-FIRST
   * option arrives with a nonzero measured elasticity and NO
   * `zero_reason: 'intervention_override'` stamp. `filterInterventionOverrides`
   * (stamp-only) lets it through; the D-U union does not.
   */
  const UNSTAMPED_LEVER = 'fac_salary_cost';

  /** Canonical order: non-levers first, the unstamped lever demoted to the back. */
  const rows: any[] = [
    { factor_id: 'fac_hiring_cost', factor_label: 'Hiring Cost', elasticity: 0.5, influence_score: 0.5, importance_rank: 1, direction: 'negative' },
    { factor_id: 'fac_team_maturity', factor_label: 'Team Maturity', elasticity: 0.4, influence_score: 0.4, importance_rank: 2, direction: 'positive' },
    // ⚠ NO zero_reason — the stamp does not cover it. Highest |elasticity|.
    { factor_id: UNSTAMPED_LEVER, factor_label: 'Salary Cost', elasticity: 0.9, influence_score: 0.9, importance_rank: 3, direction: 'negative' },
  ];

  const driverOrder = {
    version: 1 as const,
    basis: 'graph_structural' as const,
    ranked_factor_ids: rows.map((f) => f.factor_id),
    species: 'single' as const,
    lever_policy: 'du_union' as const,
    lever_ids: [UNSTAMPED_LEVER],
    separability: { top_pair_separable: null, method: null },
    rank_stability: { max_rank_flip_rate: null, min_attribution_stability: null },
  };

  /** The minimum `assembleBrief` needs before it will return a brief at all. */
  const briefPreconditions = {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: [
      { option_id: 'opt_a', label: 'A', win_probability: 0.7, status: 'computed' },
      { option_id: 'opt_b', label: 'B', win_probability: 0.3, status: 'computed' },
    ],
    robustness: { level: 'moderate' },
    meta: { seed_used: '4242' },
  };

  function build(input: Record<string, unknown> = {}) {
    return assembleBrief({
      ...briefPreconditions,
      factor_sensitivity: rows as any,
      driver_order: driverOrder as any,
      ...input,
    } as any);
  }

  it('positive control: the stamp really does miss this lever, and it really would win an |elasticity| sort', () => {
    const lever = rows.find((f) => f.factor_id === UNSTAMPED_LEVER)!;
    expect(lever.zero_reason, 'the separating property: NO stamp').toBeUndefined();
    const byElasticity = [...rows].sort((a, b) => Math.abs(b.elasticity) - Math.abs(a.elasticity));
    expect(byElasticity[0].factor_id).toBe(UNSTAMPED_LEVER);
    expect(driverOrder.ranked_factor_ids[0]).not.toBe(UNSTAMPED_LEVER);
  });

  it('⭐ RED before S1b: top_drivers[0] names ranked_factor_ids[0], never the unstamped lever', () => {
    const brief = build();
    expect(brief?.top_drivers?.[0]?.factor_label).toBe('Hiring Cost');
  });

  it('the unstamped lever is EXCLUDED from top_drivers entirely (it is not a tunable driver)', () => {
    const brief = build();
    expect(brief?.top_drivers?.map((d) => d.factor_label)).not.toContain('Salary Cost');
  });

  it('top_drivers follows the canonical order over the surviving non-levers', () => {
    const brief = build();
    expect(brief?.top_drivers?.map((d) => d.factor_label)).toEqual(['Hiring Cost', 'Team Maturity']);
  });

  it('fails CLOSED when no order is attested: absent driver_order ⇒ the stamp-only legacy path, unchanged', () => {
    // S1b must not make an OLDER caller worse. Without `driver_order` the brief
    // keeps exactly its pre-S1b behaviour rather than silently treating "no
    // levers named" as "no levers exist".
    const brief = assembleBrief({
      ...briefPreconditions,
      factor_sensitivity: rows as any,
    } as any);
    expect(brief?.top_drivers?.[0]?.factor_label).toBe('Salary Cost');
  });
});

// ===========================================================================
// LEG 3 — the facts path: a POSITION is not a RANK
// ===========================================================================
describe('the facts path SOURCES importance_rank from the canonical rank, not from the array position', () => {
  /**
   * On every live payload the emitted array order IS the canonical order
   * (Rule S3), so `idx + 1` and `importance_rank` coincide and no end-to-end
   * fixture can tell them apart. The separating input is therefore an array
   * whose position and rank DISAGREE — which is exactly the state a future
   * re-order would produce, and the state under which a positional derivation
   * silently publishes a different #1 into `fact_objects`.
   */
  const rowsRankDisagreesWithPosition: any[] = [
    { factor_id: 'fac_b', factor_label: 'B', importance_rank: 2, sensitivity_score: 0.2, elasticity: 0.2 },
    { factor_id: 'fac_a', factor_label: 'A', importance_rank: 1, sensitivity_score: 0.9, elasticity: 0.9 },
  ];

  it('positive control: position and rank really do disagree in this input', () => {
    expect(rowsRankDisagreesWithPosition[0].importance_rank).not.toBe(1);
    expect(rowsRankDisagreesWithPosition[1].importance_rank).toBe(1);
  });

  it('⭐ RED before S1b: rank 1 follows importance_rank, not the array index', () => {
    const mapped = mapFactorSensitivityToFactsInput(rowsRankDisagreesWithPosition);
    expect(mapped.find((m) => m.importance_rank === 1)?.node_id).toBe('fac_a');
    expect(mapped.find((m) => m.node_id === 'fac_b')?.importance_rank).toBe(2);
  });

  it('a row with no producer rank falls back to its position in the CANONICAL array, and nothing else', () => {
    const mapped = mapFactorSensitivityToFactsInput([
      { factor_id: 'fac_x', sensitivity_score: 0.1 },
      { factor_id: 'fac_y', sensitivity_score: 0.2 },
    ] as any);
    expect(mapped.map((m) => m.importance_rank)).toEqual([1, 2]);
  });

  it('agrees with the committed golden — the change is provenance, and it is value-identical there', () => {
    const mapped = mapFactorSensitivityToFactsInput(GOLDEN_ROWS as any);
    expect(mapped.map((m) => m.node_id)).toEqual(GOLDEN_ROWS.map((f) => f.factor_id));
    expect(mapped.map((m) => m.importance_rank)).toEqual(
      GOLDEN_ROWS.map((f) => f.importance_rank),
    );
    expect(mapped.find((m) => m.importance_rank === 1)?.node_id).toBe(CANONICAL_TOP_ID);
  });
});
