/**
 * ⭐ `driver_order.separability` — the PROVISIONAL separability default
 * (family 4, the tie verdict of amendment §6.3).
 *
 * ## What changed, and what did NOT
 *
 * S1 (PLoT #287) shipped `top_pair_separable` that could only ever emit a
 * PROVEN `false` (exact tie) or `null`. `true` was unreachable at those bytes,
 * deliberately: deciding *separable* needs a threshold, and no threshold for
 * the DRIVER order had been ratified.
 *
 * Paul ratified a PROVISIONAL default on 2026-07-28 (do not wait for Neil's
 * statistic). This spec pins what that default may and may not do:
 *
 *   · it decides ONLY when both basis values are present, finite and ordered —
 *     absence still yields `null`, and `null` still means UNRESOLVED (T2);
 *   · the exact-tie path is BYTE-UNCHANGED, method string included;
 *   · the method string NAMES the statistic, the threshold and its provisional
 *     status, so a consumer can never hold the verdict without its provenance
 *     (T3: one threshold, on the wire — not three in three repos);
 *   · it refuses to decide across the LEVER PARTITION or across two row
 *     SPECIES, because in neither state is the emitted order a sort on the
 *     quantity being compared.
 *
 * ## ⚠ The number is DERIVED, not copied
 *
 * The threshold is bound to `NEAR_TIE_THRESHOLD` — the repo's one ratified
 * near-tie magnitude — rather than hand-written as `0.10`, so the two cannot
 * drift apart silently (trap 12). The binding is ALSO pinned to the literal
 * `0.10` below: if someone changes the options-side constant for an unrelated
 * product reason, that must be a LOUD failure here, not a silent move of the
 * driver verdict.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDriverOrder,
  PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP,
  SEPARABILITY_METHOD_EXACT_TIE,
  SEPARABILITY_METHOD_RELATIVE_GAP,
  type DriverOrderFactorRow,
} from '../src/lib/driver-order.js';
import { NEAR_TIE_THRESHOLD } from '../src/trust/result-coherence.js';

function row(
  factor_id: string,
  extra: Partial<DriverOrderFactorRow> = {},
): DriverOrderFactorRow {
  return { factor_id, source: 'graph', influence_score: 0.5, ...extra };
}

const GRAPH_PATH = 'graph+isl_merge';

function separabilityOf(
  factors: DriverOrderFactorRow[],
  structuralLeverIds: ReadonlySet<string> = new Set(),
) {
  return buildDriverOrder({
    factors,
    structuralLeverIds,
    factorSensitivitySource: GRAPH_PATH,
    islSuppressedAttributions: undefined,
  })!.separability;
}

// ===========================================================================
// The threshold's provenance
// ===========================================================================
describe('the provisional threshold is DERIVED from the repo convention, and fails loud on drift', () => {
  it('is bound to NEAR_TIE_THRESHOLD — not a second near-tie number invented for drivers', () => {
    expect(PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP).toBe(NEAR_TIE_THRESHOLD);
  });

  it('⚠ and is ALSO pinned to 0.10 — a change to the options-side constant must RED here, not move this verdict silently', () => {
    expect(PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP).toBe(0.1);
  });

  it('the method string carries statistic + threshold + provisional status, derived from the constant', () => {
    expect(SEPARABILITY_METHOD_RELATIVE_GAP).toBe('relative_gap_0.10_provisional');
    expect(SEPARABILITY_METHOD_RELATIVE_GAP).toContain('provisional');
    expect(SEPARABILITY_METHOD_EXACT_TIE).toBe('basis_value_exact_tie');
  });
});

// ===========================================================================
// The exact-tie path — UNCHANGED
// ===========================================================================
describe('the exact-tie path is unchanged by the default', () => {
  it('⭐ an EXACT tie is still a PROVEN non-separation, under its own method name', () => {
    const s = separabilityOf([row('a', { influence_score: 0.42 }), row('b', { influence_score: 0.42 })]);
    expect(s.top_pair_separable).toBe(false);
    expect(s.method).toBe(SEPARABILITY_METHOD_EXACT_TIE);
    // NOT relabelled as a relative-gap verdict: an exact tie needs no threshold
    // and must not inherit a provisional one.
    expect(s.method).not.toBe(SEPARABILITY_METHOD_RELATIVE_GAP);
  });

  it('an exact tie at ZERO is still an exact tie, not a divide-by-zero', () => {
    const s = separabilityOf([row('a', { influence_score: 0 }), row('b', { influence_score: 0 })]);
    expect(s.top_pair_separable).toBe(false);
    expect(s.method).toBe(SEPARABILITY_METHOD_EXACT_TIE);
  });
});

// ===========================================================================
// ⭐ The default itself
// ===========================================================================
describe('the provisional default decides separability when — and only when — it can', () => {
  it('⭐ RED before this slice: a gap comfortably above the threshold is SEPARABLE', () => {
    // (0.50 - 0.30) / 0.50 = 0.40 ≥ 0.10
    const s = separabilityOf([row('a', { influence_score: 0.5 }), row('b', { influence_score: 0.3 })]);
    expect(s.top_pair_separable).toBe(true);
    expect(s.method).toBe(SEPARABILITY_METHOD_RELATIVE_GAP);
  });

  it('⭐ a gap below the threshold is NOT separable — and says which method decided it', () => {
    // (0.500 - 0.475) / 0.500 = 0.05 < 0.10
    const s = separabilityOf([row('a', { influence_score: 0.5 }), row('b', { influence_score: 0.475 })]);
    expect(s.top_pair_separable).toBe(false);
    expect(s.method).toBe(SEPARABILITY_METHOD_RELATIVE_GAP);
  });

  it('the comparison is INCLUSIVE: a relative gap of exactly 0.10 is SEPARABLE', () => {
    // (10 - 9) / 10 is exactly the double 0.1 — no rounding in the way, so this
    // pins the operator (`>=`) rather than a floating-point accident.
    expect((10 - 9) / 10).toBe(PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP);
    const s = separabilityOf([row('a', { influence_score: 10 }), row('b', { influence_score: 9 })]);
    expect(s.top_pair_separable).toBe(true);
  });

  it('⚠ DISCLOSED LIMITATION: at the last bit the verdict is a floating-point coin-toss', () => {
    // (1 - 0.9) / 1 evaluates to 0.09999999999999998, so a pair a human would
    // call "exactly at the threshold" lands on the NOT-separable side, while
    // (0.4 - 0.36) / 0.4 = 0.10000000000000009 lands on the other.
    //
    // This is not a bug to paper over with an epsilon — it is what a gap
    // between two point estimates is worth near its own threshold, and it is
    // one more reason `method` says `provisional`. Pinned so the behaviour is
    // KNOWN rather than discovered by a consumer.
    expect((1 - 0.9) / 1).toBeLessThan(PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP);
    expect(
      separabilityOf([row('a', { influence_score: 1 }), row('b', { influence_score: 0.9 })])
        .top_pair_separable,
    ).toBe(false);
    expect(
      separabilityOf([row('a', { influence_score: 0.4 }), row('b', { influence_score: 0.36 })])
        .top_pair_separable,
    ).toBe(true);
  });

  it('⭐ the statistic is RELATIVE, not absolute — the same ratio decides the same way at any scale', () => {
    // The basis quantity is normalised by the MAX row (|influence| /
    // maxAbsInfluence), and after the lever demotion the max row need not be in
    // the pair at all. An ABSOLUTE gap would therefore be moved by a number
    // outside the comparison; a relative gap is invariant to it.
    const big = separabilityOf([row('a', { influence_score: 0.5 }), row('b', { influence_score: 0.4 })]);
    const small = separabilityOf([row('a', { influence_score: 0.05 }), row('b', { influence_score: 0.04 })]);
    expect(big.top_pair_separable).toBe(true);
    expect(small.top_pair_separable).toBe(true);
    expect(small.method).toBe(big.method);

    // The control: an absolute-gap rule at 0.10 would have called the second
    // pair NOT separable. Prove the two rules genuinely disagree here, so this
    // assertion is not passing for an unrelated reason.
    expect(0.05 - 0.04).toBeLessThan(PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP);
  });

  it('a rival at zero against a positive leader is separable (relative gap 1.0)', () => {
    const s = separabilityOf([row('a', { influence_score: 0.3 }), row('b', { influence_score: 0 })]);
    expect(s.top_pair_separable).toBe(true);
  });
});

// ===========================================================================
// FAIL-HONEST — absence is still UNRESOLVED
// ===========================================================================
describe('fail-honest: the default decides only when both values are present and finite', () => {
  it('an ABSENT basis value is neither a tie nor a separation — unresolved', () => {
    const s = separabilityOf([row('a', { influence_score: undefined }), row('b', { influence_score: 0.3 })]);
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });

  it('a NULL basis value on the runner-up is unresolved, never coalesced to 0', () => {
    // A `?? 0` here would read as "the rival has no influence" and publish a
    // confident `true`. Absent means unavailable, not zero.
    const s = separabilityOf([row('a', { influence_score: 0.9 }), row('b', { influence_score: null })]);
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });

  it('a NON-FINITE basis value is unresolved', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const s = separabilityOf([row('a', { influence_score: bad }), row('b', { influence_score: 0.3 })]);
      expect(s.top_pair_separable, `influence_score ${bad}`).toBeNull();
    }
  });

  it('a single row has no top PAIR — unresolved, not separable', () => {
    expect(separabilityOf([row('only')]).top_pair_separable).toBeNull();
  });

  it("an empty order carries no verdict at all (basis 'none')", () => {
    const o = buildDriverOrder({
      factors: [],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.basis).toBe('none');
    expect(o.separability).toEqual({ top_pair_separable: null, method: null });
  });

  it('a non-positive leader cannot form a relative gap — unresolved, not a fabricated verdict', () => {
    const s = separabilityOf([row('a', { influence_score: 0 }), row('b', { influence_score: -0.2 })]);
    expect(s.top_pair_separable).toBeNull();
  });

  it('⭐ a NEGATIVE runner-up is off the basis scale — unresolved, never a confident "separable"', () => {
    // `influence_score` is |influence| / maxAbsInfluence, so this is unreachable
    // on a live payload — but without the guard the relative gap would be
    // (0.5 − −0.2)/0.5 = 1.4 and the producer would publish a confident `true`
    // about a pair that is not on this scale at all. A fabrication is a
    // fabrication whether or not today's inputs can reach it.
    expect((0.5 - -0.2) / 0.5).toBeGreaterThan(PROVISIONAL_TOP_PAIR_SEPARABILITY_MIN_RELATIVE_GAP);
    const s = separabilityOf([row('a', { influence_score: 0.5 }), row('b', { influence_score: -0.2 })]);
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });
});

// ===========================================================================
// ⭐ THE PARTITION-STRADDLE EDGE (S1 review LOW) — fail closed
// ===========================================================================
describe('the verdict refuses to compare across the lever partition, or across two species', () => {
  it('positive control: the straddling pair really is out of order on the basis quantity', () => {
    // One non-lever, one lever. The lever keeps its real structural influence
    // (only sensitivity/elasticity/VOI are zeroed), and it is bigger — so the
    // emitted order does NOT descend on `influence_score` across this pair.
    const rows = [row('driver', { influence_score: 0.4 }), row('lever', { influence_score: 1 })];
    expect(rows[1].influence_score!).toBeGreaterThan(rows[0].influence_score!);
  });

  it('⭐ rows 0/1 on OPPOSITE sides of the lever partition ⇒ UNRESOLVED, never a verdict', () => {
    const s = separabilityOf(
      [row('driver', { influence_score: 0.4 }), row('lever', { influence_score: 1 })],
      new Set(['lever']),
    );
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });

  it('⭐ an EXACT tie across the partition is NOT a proven tie either — the two were never ordered together', () => {
    // The sharpest form of the edge: equal numbers on opposite sides of a
    // partition are a coincidence, not a measured non-separation.
    const s = separabilityOf(
      [row('driver', { influence_score: 0.42 }), row('lever', { influence_score: 0.42 })],
      new Set(['lever']),
    );
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });

  it('BOTH rows levers (an all-lever order) is the SAME partition — the verdict is allowed', () => {
    const s = separabilityOf(
      [row('lever_a', { influence_score: 0.9 }), row('lever_b', { influence_score: 0.2 })],
      new Set(['lever_a', 'lever_b']),
    );
    expect(s.top_pair_separable).toBe(true);
  });

  it('⭐ two SPECIES (a graph row and an ISL-only row) are incommensurable ⇒ UNRESOLVED', () => {
    const s = separabilityOf([
      row('graph_row', { source: 'graph', influence_score: 0.9 }),
      row('isl_row', { source: 'isl', influence_score: 0.2 }),
    ]);
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });

  it('a mixed array whose TOP PAIR is single-species still gets a verdict (the guard is about the pair)', () => {
    const o = buildDriverOrder({
      factors: [
        row('graph_a', { source: 'graph', influence_score: 0.9 }),
        row('graph_b', { source: 'graph', influence_score: 0.2 }),
        row('isl_tail', { source: 'isl', influence_score: 0.1 }),
      ],
      structuralLeverIds: new Set(),
      factorSensitivitySource: GRAPH_PATH,
      islSuppressedAttributions: undefined,
    })!;
    expect(o.species).toBe('mixed_graph_isl');
    expect(o.separability.top_pair_separable).toBe(true);
  });

  it('an out-of-order pair within ONE partition is still unresolved — the order is not a sort on this quantity', () => {
    const s = separabilityOf([row('a', { influence_score: 0.2 }), row('b', { influence_score: 0.9 })]);
    expect(s.top_pair_separable).toBeNull();
    expect(s.method).toBeNull();
  });
});
