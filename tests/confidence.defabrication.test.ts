import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../src/trust/confidence.js';
import type { Graph } from '../src/trust/types.js';

/**
 * Fabrication removal (disposition 11(b), simplify-review confirmed).
 *
 * The former "calibration" factor was a placeholder: it resolved to a fixed
 * 0.5 on every production call (all callers passed `calibrated: false`, so the
 * term never varied with any input) yet carried 15% of the 1000-unit weight
 * budget and added a constant +75/1000 (+0.075) to every published score. A
 * confidence number the product presents as computed was 15% (by weight) a
 * fabricated constant.
 *
 * These tests pin the published confidence to ONLY its three genuinely-computed
 * factors — identifiability, linearity, k-coverage — renormalised to sum 1000
 * (412 : 294 : 294). Every expected value below was computed by hand from that
 * formula, independent of the implementation, so the corpus is an external
 * oracle rather than a mirror of the code.
 *
 * RED-first: every case here fails while the 0.5 calibration placeholder is
 * present (it shifts scores and injects a `factors.calibration` field).
 */

const g = (nodes: number, edges: number): Graph => ({
  nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, label: `n${i}` })),
  edges: Array.from({ length: edges }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
});

// k_samples buckets: >=1000 -> k_coverage 1.0, 500-999 -> 0.7, <500 -> 0.3
// Expected scores derived by hand from raw = round(ident*412/1000)
//   + round(linear*294/1000) + round(kcov*294/1000), score = round(raw/10)/100.
interface Case {
  name: string;
  identifiable: boolean;
  in_linear_range: boolean;
  k_samples: number;
  score: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
}

const CORPUS: Case[] = [
  // all-factors-strong: only reachable to 1.00 if the 3 factors carry FULL weight
  { name: 'all-strong', identifiable: true, in_linear_range: true, k_samples: 1000, score: 1.0, level: 'HIGH' },
  // all-factors-weak
  { name: 'all-weak', identifiable: false, in_linear_range: false, k_samples: 100, score: 0.36, level: 'LOW' },
  // mixed: strong identifiability, outside linear range, full k
  { name: 'strong-ident-outside-linear-fullK', identifiable: true, in_linear_range: false, k_samples: 1000, score: 0.85, level: 'HIGH' },
  // mixed: weak identifiability, in range, full k
  { name: 'weak-ident-inrange-fullK', identifiable: false, in_linear_range: true, k_samples: 1000, score: 0.71, level: 'MEDIUM' },
  // mixed: strong ident, outside range, low k -> genuine MEDIUM
  { name: 'strong-ident-outside-lowK', identifiable: true, in_linear_range: false, k_samples: 100, score: 0.65, level: 'MEDIUM' },
  // boundary: strong ident+linear, low k
  { name: 'strong-ident-linear-lowK', identifiable: true, in_linear_range: true, k_samples: 100, score: 0.79, level: 'HIGH' },
  // boundary just above MEDIUM floor
  { name: 'weak-ident-inrange-lowK', identifiable: false, in_linear_range: true, k_samples: 100, score: 0.51, level: 'MEDIUM' },
  // weak ident, outside range, full k
  { name: 'weak-ident-outside-fullK', identifiable: false, in_linear_range: false, k_samples: 1000, score: 0.57, level: 'MEDIUM' },
];

describe('Confidence — no fabricated calibration term', () => {
  it('emits no calibration factor (the placeholder is gone)', () => {
    const out = calculateConfidence({ graph: g(5, 4), identifiable: true, in_linear_range: true, k_samples: 1000 });
    // RED while the placeholder exists: it emits factors.calibration = 0.5
    expect('calibration' in out.factors).toBe(false);
    expect((out.factors as Record<string, unknown>).calibration).toBeUndefined();
  });

  it('all-strong reaches exactly 1.00 — only possible if the 3 real factors carry the whole budget', () => {
    // RED while the placeholder exists: max score is capped at 0.93 because the
    // 0.5 calibration term contributes 75 of a possible 150 to the 1000 scale.
    const out = calculateConfidence({ graph: g(5, 4), identifiable: true, in_linear_range: true, k_samples: 1000 });
    expect(out.score).toBe(1.0);
  });

  it.each(CORPUS)('$name -> score $score, level $level (computed factors only)', (c) => {
    const out = calculateConfidence({
      graph: g(5, 4),
      identifiable: c.identifiable,
      in_linear_range: c.in_linear_range,
      k_samples: c.k_samples,
    });
    expect(out.score).toBe(c.score);
    expect(out.level).toBe(c.level);
    // The three factors are present and computed; no fabricated fourth term.
    expect(out.factors.identifiability).toBe(c.identifiable ? 1.0 : 0.3);
    expect(out.factors.linearity_distance).toBe(c.in_linear_range ? 1.0 : 0.5);
  });

  it('score is fully explained by the three factors — no residual constant floor', () => {
    // With the placeholder gone, the weakest possible inputs must NOT retain a
    // hidden constant addend. Weakest = ident 0.3, linear 0.5, kcov 0.3:
    //   round(300*412/1000)=124 + round(500*294/1000)=147 + round(300*294/1000)=88 = 359
    // RED while the placeholder exists: it adds +75 -> raw 380 -> score 0.38.
    const out = calculateConfidence({ graph: g(1, 0), identifiable: false, in_linear_range: false, k_samples: 100 });
    expect(out.score).toBe(0.36);
  });
});
