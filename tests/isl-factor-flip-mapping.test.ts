/**
 * ROADMAP 2.228-F3 — ISL `factor_flip_values` → `enrichment.flip_thresholds[]`.
 *
 * THE GAP THIS SUITE PINS. ISL PR #117 (merged, deploy-confirmed at `35149dd1`)
 * computes closed-form factor flips, but the capability is REQUEST-GATED:
 * `FactorFlipValueV2` is emitted only when the request carries
 * `include_factor_flips` (ISL default `False`). PLoT at `29703ee4` contained
 * ZERO references to `factor_flip` — it neither sent the flag nor mapped the
 * response — so `flip_thresholds[].flip_value` was null on every live run and no
 * flip card has ever fired.
 *
 * RED-FIRST. Two assertions in this file fail at `29703ee4` by construction:
 *   · `toISLRobustnessRequest` omits `include_factor_flips` entirely;
 *   · nothing consumes `factor_flip_values`, so a FactorFlipValueV2-bearing
 *     envelope produces no rows at all.
 * Both are proven RED by reverting the fix — see the PR's mutation evidence.
 *
 * FIXTURE PROVENANCE. Every ISL row below is shaped from ISL's own Pydantic
 * model `FactorFlipValueV2` / `FactorFlipStabilityBandV2`
 * (`src/models/response_v2.py:628-771` at ISL `35149dd1`), serialised the way
 * ISL serialises — `model_dump(by_alias=True, exclude_none=True)`, so an absent
 * optional is an ABSENT KEY, not an explicit null. A fixture built only to
 * demonstrate the happy path cannot hunt for the mapping's absence, so the
 * adversarial half below carries: a row missing a required field, an attested
 * no-flip, a candidate that was never evaluated, an unknown reason token from
 * the open vocabulary, and a producer contradiction (`found` with no value).
 */

import { describe, it, expect } from 'vitest';
import {
  mapIslFactorFlipValues,
  FOUND_WITHOUT_VALUE_REASON,
  UNATTESTED_REASON,
  NO_DIRECTION,
} from '../src/integrations/isl/adapters/factor-flip-values.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import { denormaliseFlipThresholds } from '../src/lib/flip-threshold-denormaliser.js';
import { classifyFlipThresholdsStatus } from '../src/lib/flip-threshold-status.js';
import type { EngineGraphV3, EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

// =============================================================================
// Fixtures
// =============================================================================

const OPTIONS = [
  { id: 'opt_status_quo', label: 'Status quo' },
  { id: 'opt_locum', label: 'Locum cover' },
];

/** The live a7 node shape: normalised value + authoritative cap + the user's raw number. */
function cappedNode(
  id: string,
  overrides: Partial<NonNullable<EngineNodeV3['observed_state']>> = {},
): EngineNodeV3 {
  return {
    id,
    kind: 'factor',
    label: 'Annual Staffing Cost',
    observed_state: { value: 0.86, unit: 'GBP', raw_value: 275000, cap: 320000, ...overrides },
  } as EngineNodeV3;
}

/** Deliberately CAPLESS — deriveRange lands on the [0,1] default, which must NOT earn 'display'. */
function caplessNode(id: string): EngineNodeV3 {
  return {
    id,
    kind: 'factor',
    label: 'Service Model',
    observed_state: { value: 0.5 },
  } as EngineNodeV3;
}

function graphOf(nodes: EngineNodeV3[]): EngineGraphV3 {
  return { nodes, edges: [] } as EngineGraphV3;
}

/**
 * One ISL row, faithful to `FactorFlipValueV2`. Keys whose ISL value would be
 * `None` are OMITTED by the caller, mirroring `exclude_none`.
 */
function islRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    factor_id: 'fac_annual_staffing_cost',
    current_value: 0.86,
    flip_value: 0.62,
    direction: 'decrease',
    flip_reason: 'found',
    alternative_winner_id: 'opt_locum',
    baseline_winner_id: 'opt_status_quo',
    stability: {
      n_seeds: 10,
      n_seeds_flipped: 7,
      band_min: 0.58,
      band_median: 0.63,
      band_max: 0.69,
      band_width: 0.11,
      seed_flip_values: [0.58, 0.6, null, 0.63, 0.64, null, 0.66, 0.68, 0.69, null],
    },
    ...overrides,
  };
}

const SENSITIVITY = [
  { factor_id: 'fac_annual_staffing_cost', factor_label: 'Annual Staffing Cost' },
  { factor_id: 'fac_lever', factor_label: 'Service Model' },
];

// =============================================================================
// 1. THE REQUEST GATE — RED at 29703ee4
// =============================================================================

describe('2.228-F3 · the ISL request asks for factor flips', () => {
  const GRAPH = graphOf([cappedNode('fac_annual_staffing_cost')]);
  const OPTS: OptionV3[] = [
    { id: 'opt_status_quo', label: 'Status quo', interventions: {} },
    { id: 'opt_locum', label: 'Locum cover', interventions: {} },
  ] as OptionV3[];

  it('THE GATE: include_factor_flips is sent as true', () => {
    const req = toISLRobustnessRequest(GRAPH, OPTS, 'outcome', 'req-f3-1');
    // ISL defaults this to False and emits factor_flip_values ONLY when it is
    // true. Omitting the key is exactly what kept the capability dark.
    expect(req.include_factor_flips).toBe(true);
  });

  it('POSITIVE CONTROL: the assertion above can see a request flag at all', () => {
    // If this file could not observe request flags, the gate assertion would
    // pass (or fail) for reasons unrelated to the flag under test. These two
    // siblings have been unconditionally true since long before this lane.
    const req = toISLRobustnessRequest(GRAPH, OPTS, 'outcome', 'req-f3-2');
    expect(req.include_e_values).toBe(true);
    expect(req.include_voi).toBe(true);
  });

  it('is unconditional — not a request-gated opt-in like include_path_decomposition', () => {
    // No caller passes an opt-in for it, and none should: flip values are the
    // only source of flip_thresholds[].flip_value now the probe is retired.
    const req = toISLRobustnessRequest(GRAPH, OPTS, 'outcome', 'req-f3-3');
    expect(req.include_factor_flips).toBe(true);
    expect(req.include_path_decomposition).toBeUndefined();
  });
});

// =============================================================================
// 2. THE MAPPING — RED at 29703ee4 (nothing consumed the block)
// =============================================================================

describe('2.228-F3 · mapIslFactorFlipValues', () => {
  const GRAPH = graphOf([cappedNode('fac_annual_staffing_cost'), caplessNode('fac_lever')]);

  it('THE MAPPING: a found row becomes a flip row carrying its flip value', () => {
    const result = mapIslFactorFlipValues([islRow()], {
      graph: GRAPH,
      factorSensitivity: SENSITIVITY,
    });
    expect(result).toBeDefined();
    expect(result!.rows).toHaveLength(1);

    const row = result!.rows[0];
    expect(row.factor_id).toBe('fac_annual_staffing_cost');
    expect(row.flip_value).toBe(0.62);
    expect(row.flip_reason).toBe('found');
    expect(row.direction).toBe('decrease');
    expect(row.alternative_winner_id).toBe('opt_locum');
    // Label is PLoT-side presentation data; ISL emits factor_id only.
    expect(row.factor_label).toBe('Annual Staffing Cost');
    // Unit comes from the graph node, never from ISL.
    expect(row.unit).toBe('GBP');
    // Closed form: zero bisection iterations and zero probes BY CONSTRUCTION.
    expect(row.iterations_used).toBe(0);
    expect(row.probes_used).toBe(0);
    expect(result!.diagnostics.found).toBe(1);
  });

  it('falls back to the node label, then the id, when sensitivity carries no label', () => {
    const noLabel = mapIslFactorFlipValues([islRow()], { graph: GRAPH });
    expect(noLabel!.rows[0].factor_label).toBe('Annual Staffing Cost'); // node.label

    const noGraph = mapIslFactorFlipValues([islRow()], {});
    expect(noGraph!.rows[0].factor_label).toBe('fac_annual_staffing_cost'); // id of last resort
    expect(noGraph!.rows[0].unit).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // ABSENCE IS NOT EMPTINESS
  // ---------------------------------------------------------------------------

  it('ABSENT BLOCK: undefined/null returns undefined — "not computed", not "nothing flips"', () => {
    // The distinction is the whole point. `undefined` must reach the route as
    // flip_thresholds_status 'unavailable'; collapsing it to [] would let the
    // classifier report 'all_no_effect' — a claim nobody computed.
    expect(mapIslFactorFlipValues(undefined, { graph: GRAPH })).toBeUndefined();
    expect(mapIslFactorFlipValues(null, { graph: GRAPH })).toBeUndefined();
  });

  it('EMPTY BLOCK: [] returns zero rows — ISL ran the phase and found no eligible factors', () => {
    const result = mapIslFactorFlipValues([], { graph: GRAPH });
    expect(result).toBeDefined();
    expect(result!.rows).toEqual([]);
    expect(result!.diagnostics.received).toBe(0);
  });

  it('a non-array block is refused, not coerced', () => {
    expect(mapIslFactorFlipValues({ factor_id: 'x' }, { graph: GRAPH })).toBeUndefined();
    expect(mapIslFactorFlipValues('factor_flip_values', { graph: GRAPH })).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // ADVERSARIAL: the rows a demonstration fixture would never contain
  // ---------------------------------------------------------------------------

  it('ADVERSARIAL — missing required field: the row is rejected and COUNTED, not repaired', () => {
    const result = mapIslFactorFlipValues(
      [
        { current_value: 0.5, flip_reason: 'found', baseline_winner_id: 'opt_status_quo' }, // no factor_id
        { factor_id: 'fac_x', flip_reason: 'found', baseline_winner_id: 'opt_status_quo' }, // no current_value
        { factor_id: 'fac_y', current_value: 'nope', flip_reason: 'found' }, // wrong type
        null,
        islRow(),
      ],
      { graph: GRAPH },
    );
    expect(result!.rows).toHaveLength(1);
    expect(result!.diagnostics.rejected_malformed).toBe(4);
    expect(result!.diagnostics.received).toBe(5);
  });

  it('ADVERSARIAL — attested no-flip: structurally_invariant keeps its row and its attestation', () => {
    // ISL: "a MATHEMATICAL ATTESTATION, not a failed or timed-out probe".
    // The row must survive: an attested no-flip is a RESULT, and dropping it
    // would be indistinguishable from never having asked.
    const result = mapIslFactorFlipValues(
      [
        {
          factor_id: 'fac_lever',
          current_value: 0.5,
          flip_reason: 'structurally_invariant',
          baseline_winner_id: 'opt_status_quo',
          // flip_value / direction / alternative_winner_id / stability all
          // OMITTED by exclude_none — ISL emits no band for a proven no-flip.
        },
      ],
      { graph: GRAPH },
    );
    const row = result!.rows[0];
    expect(row.flip_reason).toBe('structurally_invariant');
    expect(row.flip_value).toBeNull();
    // ⚠ ABSENT-NOT-ZERO. A clamped 0 is a real, in-range normalised value —
    // publishing one here would assert "this factor flips at its floor".
    expect(row.flip_value).not.toBe(0);
    // ⚠ ISL: "a direction for a flip that does not exist would be a fabricated
    // claim." The row carries the explicit non-claiming token — NEVER a guess.
    // (An absent key would be more honest still, but the shared contract types
    // this field as a required string; see NO_DIRECTION's doc.)
    expect(row.direction).toBe(NO_DIRECTION);
    expect(row.direction).not.toBe('increase');
    expect(row.direction).not.toBe('decrease');
    expect(row.alternative_winner_id).toBeNull();
  });

  it('ADVERSARIAL — no_effect_within_bounds also keeps its row and drops its direction', () => {
    const result = mapIslFactorFlipValues(
      [
        {
          factor_id: 'fac_annual_staffing_cost',
          current_value: 0.86,
          flip_reason: 'no_effect_within_bounds',
          baseline_winner_id: 'opt_status_quo',
        },
      ],
      { graph: GRAPH },
    );
    expect(result!.rows[0].flip_value).toBeNull();
    expect(result!.rows[0].direction).toBe(NO_DIRECTION);
  });

  it('ADVERSARIAL — a genuine 0.0 flip value SURVIVES (the sharp edge of absent-not-zero)', () => {
    // 0 is a legitimate normalised flip value. The doctrine forbids INVENTING a
    // zero, not carrying a measured one. A guard written as `flip_value || null`
    // would silently destroy this row's result — this is the test that catches it.
    const result = mapIslFactorFlipValues(
      [islRow({ flip_value: 0, direction: 'decrease', flip_reason: 'found' })],
      { graph: GRAPH },
    );
    expect(result!.rows[0].flip_value).toBe(0);
    expect(result!.rows[0].flip_reason).toBe('found');
    expect(result!.rows[0].direction).toBe('decrease');
  });

  it('ADVERSARIAL — producer contradiction: found with no value is DOWNGRADED, never trusted', () => {
    // Downgrading to `no_effect_within_bounds` would be worse than the bug:
    // that reason ATTESTS the slopes differ and no crossing exists, and PLoT
    // has established nothing. It gets its own token so the classifier files it
    // as unresolved.
    const result = mapIslFactorFlipValues(
      [
        { factor_id: 'fac_a', current_value: 0.3, flip_reason: 'found', baseline_winner_id: 'o1' },
        { ...islRow({ factor_id: 'fac_b' }), flip_value: Number.NaN },
        { ...islRow({ factor_id: 'fac_c' }), flip_value: null },
      ],
      { graph: GRAPH },
    );
    expect(result!.rows.map((r) => r.flip_reason)).toEqual([
      FOUND_WITHOUT_VALUE_REASON,
      FOUND_WITHOUT_VALUE_REASON,
      FOUND_WITHOUT_VALUE_REASON,
    ]);
    expect(result!.rows.every((r) => r.flip_value === null)).toBe(true);
    expect(result!.diagnostics.found_without_value).toBe(3);
    expect(result!.diagnostics.found).toBe(0);
  });

  it('ADVERSARIAL — a missing reason becomes an explicit "unattested", never a silent no-effect', () => {
    const result = mapIslFactorFlipValues(
      [{ factor_id: 'fac_a', current_value: 0.3, baseline_winner_id: 'o1' }],
      { graph: GRAPH },
    );
    expect(result!.rows[0].flip_reason).toBe(UNATTESTED_REASON);
  });

  it('ADVERSARIAL — an UNKNOWN reason token passes through verbatim (open vocabulary)', () => {
    // ISL declares the vocabulary open. Coercing an unrecognised token to a
    // known one would fabricate an attestation; the classifier is the single
    // place that decides what an unknown token MEANS.
    const result = mapIslFactorFlipValues(
      [
        {
          factor_id: 'fac_a',
          current_value: 0.3,
          flip_reason: 'some_future_isl_reason',
          baseline_winner_id: 'o1',
        },
      ],
      { graph: GRAPH },
    );
    expect(result!.rows[0].flip_reason).toBe('some_future_isl_reason');
  });

  it('ADVERSARIAL — an alternative winner named on a no-flip row is nulled', () => {
    // Defence in depth against a producer bug: naming the option that "would
    // win" after a flip that does not exist is a fabricated claim.
    const result = mapIslFactorFlipValues(
      [
        {
          factor_id: 'fac_a',
          current_value: 0.3,
          flip_reason: 'structurally_invariant',
          alternative_winner_id: 'opt_locum',
          baseline_winner_id: 'opt_status_quo',
        },
      ],
      { graph: GRAPH },
    );
    expect(result!.rows[0].alternative_winner_id).toBeNull();
  });

  it('ISL design R3: a baseline-winner disagreement is COUNTED, never reconciled away', () => {
    const result = mapIslFactorFlipValues([islRow({ baseline_winner_id: 'opt_locum' })], {
      graph: GRAPH,
      recommendedWinnerId: 'opt_status_quo',
    });
    expect(result!.diagnostics.baseline_winner_disagreement).toBe(1);
    // The row is still emitted, unmodified — disclosure, not suppression.
    expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0].flip_value).toBe(0.62);
  });

  it('agreement (or no recommendation supplied) counts zero disagreements', () => {
    expect(
      mapIslFactorFlipValues([islRow()], { graph: GRAPH, recommendedWinnerId: 'opt_status_quo' })!
        .diagnostics.baseline_winner_disagreement,
    ).toBe(0);
    expect(
      mapIslFactorFlipValues([islRow()], { graph: GRAPH })!.diagnostics
        .baseline_winner_disagreement,
    ).toBe(0);
  });
});

// =============================================================================
// 3. THROUGH #298's DENORMALISER — the display-honesty refusal must survive
// =============================================================================

describe('2.228-F3 · ISL rows through denormaliseFlipThresholds (#298 path)', () => {
  it('a capped factor reaches user units and SAYS so at row level', () => {
    const graph = graphOf([cappedNode('fac_annual_staffing_cost')]);
    const mapped = mapIslFactorFlipValues([islRow()], { graph, factorSensitivity: SENSITIVITY })!;
    const rows = denormaliseFlipThresholds(mapped.rows, undefined, OPTIONS, graph);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.value_scale).toBe('display');
    // 0.62 x 320000 = 198400 — a real user-unit number, not a [0,1] fraction.
    expect(row.flip_value).toBe(198400);
    // The authoritative raw_value still wins over the round-trip of the rounded
    // normalised value (0.86 x 320000 = 275200 vs the user's own 275000).
    expect(row.current_value).toBe(275000);
    expect(row.flip_display).toBe('198400 GBP');
    expect(row.alternative_winner_label).toBe('Locum cover');
  });

  it('THE REFUSAL SURVIVES: a capless factor never earns value_scale "display"', () => {
    // #298 refuses the [0,1] identity fallback — denormalising by [0,1] moves
    // nothing, so stamping 'display' off it would assert user-scale about a
    // number that never changed. This lane must not weaken that.
    const graph = graphOf([caplessNode('fac_lever')]);
    const mapped = mapIslFactorFlipValues(
      [islRow({ factor_id: 'fac_lever', current_value: 0.5, flip_value: 0.7 })],
      { graph },
    )!;
    const rows = denormaliseFlipThresholds(mapped.rows, undefined, OPTIONS, graph);

    expect(rows[0].value_scale).not.toBe('display');
    expect(rows[0].flip_display).toBeUndefined();
    expect(rows[0].current_display).toBeUndefined();
    // Values stay exactly as ISL emitted them — honest, normalised, unlifted.
    expect(rows[0].flip_value).toBe(0.7);
  });

  it('an attested no-flip stays null through denormalisation — no clamped zero on the wire', () => {
    const graph = graphOf([cappedNode('fac_annual_staffing_cost')]);
    const mapped = mapIslFactorFlipValues(
      [
        {
          factor_id: 'fac_annual_staffing_cost',
          current_value: 0.86,
          flip_reason: 'structurally_invariant',
          baseline_winner_id: 'opt_status_quo',
        },
      ],
      { graph },
    )!;
    const rows = denormaliseFlipThresholds(mapped.rows, undefined, OPTIONS, graph);

    expect(rows[0].flip_value).toBeNull();
    expect(rows[0].flip_display).toBeUndefined();
    // current_value still lifts — the factor has a scale even when it cannot flip.
    expect(rows[0].current_value).toBe(275000);
    expect(rows[0].value_scale).toBe('display');
    // The denormaliser must not resurrect a direction it was never given.
    expect(rows[0].direction).toBe(NO_DIRECTION);
  });
});

// =============================================================================
// 4. STATUS CLASSIFICATION — the attested/unresolved boundary
// =============================================================================

describe('2.228-F3 · flip_thresholds_status over ISL reasons', () => {
  const graph = graphOf([cappedNode('fac_annual_staffing_cost')]);

  function statusOf(rows: Array<Record<string, unknown>>) {
    const mapped = mapIslFactorFlipValues(rows, { graph })!;
    return classifyFlipThresholdsStatus(
      denormaliseFlipThresholds(mapped.rows, undefined, OPTIONS, graph),
    );
  }

  function noFlip(factor_id: string, flip_reason: string) {
    return { factor_id, current_value: 0.5, flip_reason, baseline_winner_id: 'opt_status_quo' };
  }

  it('structurally_invariant is an ATTESTED no-effect, not an unresolved failure', () => {
    // Before this lane the token was unknown to the classifier and fell to
    // 'unresolved' — reading as "the analysis did not finish" about a result
    // ISL proved. `all_no_effect` is the honest statement.
    expect(statusOf([noFlip('f1', 'structurally_invariant'), noFlip('f2', 'structurally_invariant')]))
      .toEqual({ status: 'all_no_effect' });
  });

  it('it mixes with no_effect_within_bounds as one no-effect class', () => {
    expect(statusOf([noFlip('f1', 'structurally_invariant'), noFlip('f2', 'no_effect_within_bounds')]))
      .toEqual({ status: 'all_no_effect' });
  });

  it('candidate_cap_exceeded is UNRESOLVED — a candidate never evaluated attests nothing', () => {
    const result = statusOf([noFlip('f1', 'candidate_cap_exceeded')]);
    expect(result.status).toBe('unresolved');
    expect(result.status_reason).toBe('candidate_cap_exceeded');
  });

  it('an unevaluated candidate cannot be absorbed into an all_no_effect verdict', () => {
    // The sharp case: one proven no-flip plus one never-looked-at factor must
    // NOT read as "no factor could change the leading option".
    const result = statusOf([
      noFlip('f1', 'structurally_invariant'),
      noFlip('f2', 'candidate_cap_exceeded'),
    ]);
    expect(result.status).toBe('unresolved');
  });

  it('a producer contradiction is unresolved, never a confident no-effect', () => {
    const result = statusOf([
      { factor_id: 'f1', current_value: 0.5, flip_reason: 'found', baseline_winner_id: 'o1' },
    ]);
    expect(result.status).toBe('unresolved');
    expect(result.status_reason).toBe(FOUND_WITHOUT_VALUE_REASON);
  });

  it('a real flip reports computed; mixed with an attested no-flip reports partial_no_effect', () => {
    expect(statusOf([islRow()]).status).toBe('computed');
    expect(
      statusOf([islRow(), noFlip('fac_lever', 'structurally_invariant')]).status,
    ).toBe('partial_no_effect');
  });

  it('an ABSENT ISL block yields "unavailable" — never "all_no_effect"', () => {
    // The route leaves flipThresholds undefined when the mapping returns
    // undefined. This is the assertion that stops a budget-tripped ISL phase
    // from being published as "nothing can flip".
    expect(mapIslFactorFlipValues(undefined, { graph })).toBeUndefined();
    expect(classifyFlipThresholdsStatus(undefined)).toEqual({ status: 'unavailable' });
    expect(classifyFlipThresholdsStatus([])).toEqual({ status: 'unavailable' });
  });
});
