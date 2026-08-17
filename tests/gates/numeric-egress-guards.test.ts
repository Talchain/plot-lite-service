/**
 * SCIENTIFIC REGRESSION GATE — Codex round-2: numeric-egress boundary guards
 * ----------------------------------------------------------------------------
 * Unit-pins the shared numeric validators and the ISL→PLoT transform filters that
 * keep non-finite / out-of-range ISL numbers off the public /v2/run surface.
 * Compile-time ISL types do not validate the wire JSON, so a degenerate Monte
 * Carlo run can deliver NaN/±Infinity (→ Fastify fabricates `null`) or an
 * impossible probability (e.g. 1.5). Each transform DROPS the whole affected entry
 * (required fields) or OMITS the field (optional), never emits a fabricated value.
 */

import { describe, it, expect } from 'vitest';
import { finiteNum, prob01, nonNeg, nonNegInt } from '../../src/routes/v2/numeric-egress-guards.js';
import {
  transformEdgeSensitivity,
  transformEdgeEValues,
  transformConditionalWinners,
} from '../../src/routes/v2/run.js';

const N = Number.NaN, PI = Number.POSITIVE_INFINITY, NI = Number.NEGATIVE_INFINITY;

describe('numeric-egress helper · domain validation', () => {
  it('finiteNum: rejects non-finite / non-number; passes finite incl 0 and negatives', () => {
    for (const v of [N, PI, NI, '1', null, undefined, {}]) expect(finiteNum(v)).toBeUndefined();
    expect(finiteNum(0)).toBe(0);
    expect(finiteNum(-3.5)).toBe(-3.5);
    expect(finiteNum(42)).toBe(42);
  });

  it('prob01: only finite [0,1]; rejects 1.5 / -0.01 / non-finite; preserves 0 and 1', () => {
    for (const v of [N, PI, NI, 1.5, -0.01, 2, '0.5']) expect(prob01(v)).toBeUndefined();
    expect(prob01(0)).toBe(0);
    expect(prob01(1)).toBe(1);
    expect(prob01(0.42)).toBe(0.42);
  });

  it('nonNeg: finite >= 0; rejects negatives and non-finite; preserves 0', () => {
    for (const v of [N, PI, -0.001, -5]) expect(nonNeg(v)).toBeUndefined();
    expect(nonNeg(0)).toBe(0);
    expect(nonNeg(3.2)).toBe(3.2);
  });

  it('nonNegInt: non-negative integers only', () => {
    for (const v of [N, PI, -1, 2.5, 0.1]) expect(nonNegInt(v)).toBeUndefined();
    expect(nonNegInt(0)).toBe(0);
    expect(nonNegInt(1000)).toBe(1000);
  });
});

describe('numeric-egress transforms · drop/omit invalid ISL numbers', () => {
  it('transformEdgeSensitivity drops entries with non-finite elasticity / importance_rank', () => {
    const out = transformEdgeSensitivity([
      { edge_from: 'a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.5, importance_rank: 1, interpretation: 'x' },
      { edge_from: 'b', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: N, importance_rank: 2, interpretation: 'x' },
      { edge_from: 'c', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.3, importance_rank: PI, interpretation: 'x' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].edge_id).toBe('a::goal');
    expect(out[0].elasticity).toBe(0.5);
  });

  it('transformEdgeEValues drops entries with non-finite e_value / current_mean / flip_mean', () => {
    const out = transformEdgeEValues([
      { edge_id: 'a::goal', e_value: 2, flip_direction: 'up', current_mean: 0.5, flip_mean: 0.7 },
      { edge_id: 'b::goal', e_value: PI, flip_direction: 'up', current_mean: 0.5, flip_mean: 0.7 },
      { edge_id: 'c::goal', e_value: 2, flip_direction: 'up', current_mean: N, flip_mean: 0.7 },
    ] as any);
    expect(out).toHaveLength(1);
    expect(out[0].e_value).toBe(2);
  });

  it('transformConditionalWinners drops bad split_value / out-of-[0,1] win_probability; omits non-finite mean_outcome', () => {
    // ⚠ 17 Aug 2026: the INPUT key is ISL's `winner_probability`, not PLoT's
    // outbound `win_probability` — this builder carried PLoT's name (copied from
    // the `ISLConditionalBucket` type, which claimed a name ISL never emitted), so
    // this gate passed while every real row was being dropped on live traffic.
    // Names derived at ISL `28fe0c95` (`src/models/response_v2.py:1222-1232`);
    // a wire-derived fixture lives at tests/fixtures/isl-conditional-winners-20260817/.
    const mk = (factor_id: string, split: number, lowP: number, highP: number, lowMean?: number) => ({
      factor_id, split_value: split,
      low_bucket: { winner_id: 'o1', winner_probability: lowP, ...(lowMean !== undefined && { mean_outcome: lowMean }) },
      high_bucket: { winner_id: 'o2', winner_probability: highP },
      winner_flips: true,
    });
    const out = transformConditionalWinners([
      mk('valid', 0.5, 0.6, 0.4, 0.8),
      mk('bad-split', N, 0.6, 0.4),
      mk('bad-prob', 0.5, 1.5, 0.4),   // out-of-range win_probability → drop entry
      mk('bad-mean', 0.5, 0.6, 0.4, PI), // non-finite mean_outcome → entry KEPT, mean omitted
    ] as any);
    const ids = out.map((c) => c.factor_id);
    expect(ids.sort()).toEqual(['bad-mean', 'valid']);
    expect(out.find((c) => c.factor_id === 'valid')!.low_bucket.mean_outcome).toBe(0.8);
    expect(out.find((c) => c.factor_id === 'bad-mean')!.low_bucket.mean_outcome).toBeUndefined();
  });
});
