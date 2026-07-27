/**
 * `buildDriverOrder` — the branches the live fixture cannot reach (family 4, S1).
 *
 * The fixture spec (`tests/driver-order-attestation.fixture.test.ts`) pins the
 * live graph-primary, single-species, non-tied payload end to end. This spec
 * covers the states that payload does not contain and that a consumer must
 * nonetheless be able to trust:
 *
 *   · present-empty vs absent — the distinction the family-2 side already paid
 *     for, adopted rather than re-litigated;
 *   · `mixed_graph_isl` — two incommensurable row species in one array, which
 *     before this field no consumer could detect at all;
 *   · the UNSTAMPED D-U union lever — the case ISL's `zero_reason` stamp
 *     under-covers, and the reason `lever_policy` says `du_union` and not
 *     `stamp_only`;
 *   · the PROVEN tie (`top_pair_separable: false`) and the UNRESOLVED verdict
 *     (`null`) — and that `true` is never produced;
 *   · ISL's `suppressed_attributions` sourcing `basis: 'none'` instead of it
 *     being inferred from an empty array.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDriverOrder,
  readIslSuppressedAttributions,
  type DriverOrderFactorRow,
} from '../src/lib/driver-order.js';

function row(
  factor_id: string,
  extra: Partial<DriverOrderFactorRow> = {},
): DriverOrderFactorRow {
  return { factor_id, source: 'graph', influence_score: 0.5, ...extra };
}

const GRAPH_PATH = 'graph+isl_merge';

describe('buildDriverOrder — absence semantics', () => {
  it('returns undefined ONLY when factor_sensitivity is absent — the caller then omits the key', () => {
    expect(
      buildDriverOrder({
        factors: undefined,
        structuralLeverIds: new Set(),
        factorSensitivitySource: GRAPH_PATH,
        islSuppressedAttributions: undefined,
      }),
    ).toBeUndefined();
  });

  it("present-but-empty is a DIFFERENT claim: basis 'none', emitted, never omitted", () => {
    const o = buildDriverOrder({
      factors: [],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o).toBeDefined();
    expect(o.basis).toBe('none');
    expect(o.ranked_factor_ids).toEqual([]);
    expect(o.lever_policy).toBe('none');
    expect(o.lever_ids).toEqual([]);
    // Rule S2 — the members are present and null, so a consumer fails closed on
    // a VALUE it can read, not on a key it has to guess about.
    expect(o.separability).toEqual({ top_pair_separable: null, method: null });
    expect(o.rank_stability).toEqual({
      max_rank_flip_rate: null,
      min_attribution_stability: null,
    });
  });
});

describe('buildDriverOrder — basis', () => {
  it("graph-primary path attests 'graph_structural'", () => {
    const o = buildDriverOrder({
      factors: [row('a'), row('b', { influence_score: 0.2 })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.basis).toBe('graph_structural');
  });

  it("ISL-only fallback attests 'isl_uncertainty'", () => {
    const o = buildDriverOrder({
      factors: [row('a', { source: 'isl' }), row('b', { source: 'isl', influence_score: 0.2 })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: 'isl',
      islSuppressedAttributions: undefined,
    })!;
    expect(o.basis).toBe('isl_uncertainty');
  });

  it("⭐ ISL's own suppression disclosure SOURCES basis 'none' on the ISL-only path — not inferred from an empty array", () => {
    const o = buildDriverOrder({
      factors: [row('a', { source: 'isl' }), row('b', { source: 'isl' })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: 'isl',
      islSuppressedAttributions: ['factor_sensitivity', 'p_win_sensitivity'],
    })!;
    expect(o.basis).toBe('none');
    expect(o.ranked_factor_ids).toEqual([]);
  });

  it("ISL suppression does NOT blank the basis on the graph path — PLoT's own analysis made that order", () => {
    // Calling a real graph-derived order 'none' because ISL withheld ITS
    // attributions would be a different lie, not a fix.
    const o = buildDriverOrder({
      factors: [row('a'), row('b', { influence_score: 0.2 })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: ['factor_sensitivity'],
    })!;
    expect(o.basis).toBe('graph_structural');
    expect(o.ranked_factor_ids).toEqual(['a', 'b']);
  });

  it('a suppression list that does not name factor_sensitivity leaves the basis alone', () => {
    const o = buildDriverOrder({
      factors: [row('a', { source: 'isl' })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: 'isl',
      islSuppressedAttributions: ['conditional_winners'],
    })!;
    expect(o.basis).toBe('isl_uncertainty');
  });
});

describe('buildDriverOrder — species', () => {
  it("a graph array with an ISL-only tail is 'mixed_graph_isl' (two incommensurable quantities, one array)", () => {
    const o = buildDriverOrder({
      factors: [
        row('graph_1', { source: 'graph' }),
        row('graph_2', { source: 'graph', influence_score: 0.4 }),
        row('isl_only', { source: 'isl', influence_score: 0.9 }),
      ],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.species).toBe('mixed_graph_isl');
    // ⚠ And the ISL-only row is at the TAIL with a HIGHER influence_score than
    // the graph rows above it: the array is NOT globally sorted on one number,
    // because the numbers are not the same quantity. That is exactly what this
    // attestation exists to disclose — and the order is NOT re-sorted here.
    expect(o.ranked_factor_ids).toEqual(['graph_1', 'graph_2', 'isl_only']);
  });

  it("one species is 'single', whichever species it is", () => {
    for (const source of ['graph', 'isl'] as const) {
      const o = buildDriverOrder({
        factors: [row('a', { source }), row('b', { source })],
        structuralLeverIds: new Set(),
        factorSensitivitySource: source === 'isl' ? 'isl' : GRAPH_PATH,
        islSuppressedAttributions: undefined,
      })!;
      expect(o.species).toBe('single');
    }
  });
});

describe('buildDriverOrder — lever marking (D-U union, not the stamp)', () => {
  it('⭐ marks an UNSTAMPED union lever — the case the zero_reason stamp under-covers', () => {
    const o = buildDriverOrder({
      factors: [
        row('driver'),
        row('unstamped_lever', { zero_reason: null, influence_score: 0.9 }),
      ],
      structuralLeverIds: new Set(['unstamped_lever']),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.lever_policy).toBe('du_union');
    expect(o.lever_ids).toEqual(['unstamped_lever']);
  });

  it('marks an ISL-stamped lever even when the request pinned nothing', () => {
    const o = buildDriverOrder({
      factors: [row('driver'), row('stamped', { zero_reason: 'intervention_override' })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.lever_ids).toEqual(['stamped']);
  });

  it('lever_ids follows RANK order, not input order or id order', () => {
    const o = buildDriverOrder({
      factors: [row('d1'), row('l_b'), row('d2'), row('l_a')],
      structuralLeverIds: new Set(['l_a', 'l_b']),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.lever_ids).toEqual(['l_b', 'l_a']);
  });

  it('does NOT re-order: the emitted array order IS the canonical order (S1 must not un-demote levers)', () => {
    // A lever sitting at rank 1 with the highest influence is left exactly
    // where the producer put it — this module attests the order, it does not
    // make it. Re-ordering here would change an existing emission.
    const o = buildDriverOrder({
      factors: [row('lever', { influence_score: 1 }), row('driver', { influence_score: 0.1 })],
      structuralLeverIds: new Set(['lever']),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.ranked_factor_ids).toEqual(['lever', 'driver']);
    expect(o.lever_ids).toEqual(['lever']);
  });
});

describe('buildDriverOrder — the tie verdict', () => {
  it('⭐ an EXACT tie on the basis quantity is a PROVEN non-separation', () => {
    const o = buildDriverOrder({
      factors: [row('a', { influence_score: 0.42 }), row('b', { influence_score: 0.42 })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.separability.top_pair_separable).toBe(false);
    expect(o.separability.method).toBe('basis_value_exact_tie');
  });

  it('⛔ a strict inequality is UNRESOLVED, never "separable" — no ratified driver threshold exists (T3)', () => {
    const o = buildDriverOrder({
      factors: [row('a', { influence_score: 0.9 }), row('b', { influence_score: 0.01 })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.separability.top_pair_separable).toBeNull();
    expect(o.separability.method).toBeNull();
  });

  it('a single row has no top PAIR — unresolved, not separable', () => {
    const o = buildDriverOrder({
      factors: [row('only')],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.separability.top_pair_separable).toBeNull();
  });

  it('an ABSENT basis value is neither a tie nor a separation — unresolved', () => {
    const o = buildDriverOrder({
      factors: [row('a', { influence_score: undefined }), row('b', { influence_score: 0.3 })],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.separability.top_pair_separable).toBeNull();
  });
});

describe('buildDriverOrder — rank_stability', () => {
  it('reports the WORST measured flip rate and the WORST stability band', () => {
    const o = buildDriverOrder({
      factors: [
        row('a', { rank_flip_rate: 0.05, attribution_stability: 'high' }),
        row('b', { rank_flip_rate: 0.31, attribution_stability: 'low' }),
        row('c', { rank_flip_rate: 0.2, attribution_stability: 'moderate' }),
      ],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.rank_stability.max_rank_flip_rate).toBe(0.31);
    expect(o.rank_stability.min_attribution_stability).toBe('low');
  });

  it('unmeasured stays NULL — never coalesced to 0 (absent means "unavailable", not "stable")', () => {
    const o = buildDriverOrder({
      factors: [row('a'), row('b')],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.rank_stability.max_rank_flip_rate).toBeNull();
    expect(o.rank_stability.min_attribution_stability).toBeNull();
  });

  it('ignores non-finite and unknown-band values rather than letting them win the aggregate', () => {
    const o = buildDriverOrder({
      factors: [
        row('a', { rank_flip_rate: Number.NaN, attribution_stability: 'not_a_band' }),
        row('b', { rank_flip_rate: 0.1, attribution_stability: 'moderate' }),
      ],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.rank_stability.max_rank_flip_rate).toBe(0.1);
    expect(o.rank_stability.min_attribution_stability).toBe('moderate');
  });
});

describe('buildDriverOrder — id resolution', () => {
  it('resolves ids node_id-first, the same precedence the sensitivity mapper uses', () => {
    const o = buildDriverOrder({
      factors: [{ node_id: 'canonical', factor_id: 'other', source: 'isl' }],
      structuralLeverIds: new Set(['canonical']),
      factorSensitivitySource: 'isl',
      islSuppressedAttributions: undefined,
    })!;
    expect(o.ranked_factor_ids).toEqual(['canonical']);
    expect(o.lever_ids).toEqual(['canonical']);
  });

  it('a row with no usable id is not silently given one', () => {
    const o = buildDriverOrder({
      factors: [{ source: 'graph' }, row('real')],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.ranked_factor_ids).toEqual(['real']);
  });
});

describe('readIslSuppressedAttributions', () => {
  it('reads the list ISL published', () => {
    expect(
      readIslSuppressedAttributions({
        correlation_model: { suppressed_attributions: ['factor_sensitivity'] },
      }),
    ).toEqual(['factor_sensitivity']);
  });

  it('returns undefined when ISL said nothing — which is NOT "ISL said nothing was suppressed"', () => {
    expect(readIslSuppressedAttributions(undefined)).toBeUndefined();
    expect(readIslSuppressedAttributions(null)).toBeUndefined();
    expect(readIslSuppressedAttributions({})).toBeUndefined();
    expect(readIslSuppressedAttributions({ correlation_model: null })).toBeUndefined();
    expect(readIslSuppressedAttributions({ correlation_model: {} })).toBeUndefined();
    expect(
      readIslSuppressedAttributions({ correlation_model: { suppressed_attributions: [] } }),
    ).toBeUndefined();
  });

  it('survives a malformed correlation_model without throwing', () => {
    expect(readIslSuppressedAttributions({ correlation_model: 'nope' })).toBeUndefined();
    expect(readIslSuppressedAttributions({ correlation_model: [1, 2] })).toBeUndefined();
    expect(
      readIslSuppressedAttributions({ correlation_model: { suppressed_attributions: 'x' } }),
    ).toBeUndefined();
    expect(
      readIslSuppressedAttributions({ correlation_model: { suppressed_attributions: [1, 'ok'] } }),
    ).toEqual(['ok']);
  });
});
