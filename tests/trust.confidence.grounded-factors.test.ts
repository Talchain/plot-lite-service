/**
 * Published confidence must derive ONLY from named, grounded factors.
 *
 * THE SPEC THESE ASSERT, not the defect they were written for
 * -----------------------------------------------------------
 * `calculateConfidence` publishes a `score` (0–1), a `level`, and a `factors`
 * breakdown. A caller reads that as: here is how confident the engine is, and
 * here is what drove it. Two properties have to hold for that reading to be
 * true, and both are stated below as properties of the WHOLE reachable input
 * domain rather than of any particular case:
 *
 *   1. GROUNDED — every factor the badge names must actually vary with the
 *      request. A factor that reports the same number for every possible input
 *      carries no information about the request; naming it in the breakdown
 *      tells the caller a determinant exists where none does.
 *
 *   2. ATTAINABLE — the published scale must be fully reachable. If some share
 *      of the weight budget is permanently pinned, the top of the range is
 *      unreachable by construction and every published score is displaced by a
 *      constant that no property of the graph can move.
 *
 * WHY THE DOMAIN IS THE CALL-SITE DOMAIN, NOT THE SIGNATURE DOMAIN
 * ---------------------------------------------------------------
 * These enumerate the inputs the PRODUCTION CALL SITES can construct
 * (`src/routes/v1/run.ts`, `src/routes/v1/self-check.ts`,
 * `src/inference/model_of_inference.ts`, `src/fixtures/demo-payloads.ts`), not
 * every input the signature admits. That distinction is the whole point: a
 * parameter that only a test can vary is not a determinant of any published
 * number, and a suite that reaches for it would certify a grounding the
 * product does not have. The domain is small and CLOSED — identifiability is
 * boolean, linear-range is boolean, and k-coverage has exactly three bands —
 * so this is an EXHAUSTIVE enumeration of every reachable cell, not a sample.
 *
 * WHAT WOULD HAVE TO BE TRUE FOR THESE TO PASS WHILE THE PROPERTY FAILS
 * --------------------------------------------------------------------
 * The grounding check is a discrimination, so it can only pass by observing
 * two different values; it cannot pass by observing nothing. It therefore pins
 * its own precondition explicitly: the enumeration is asserted NON-EMPTY and of
 * the exact expected size first, because a domain builder that silently
 * produced zero cells would make every `for` loop below vacuously agree.
 */

import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../src/trust/confidence.js';
import type { Graph } from '../src/trust/types.js';

/** A graph shaped like the ones the call sites pass. Node/edge counts drive the
 *  reason string only — never the score — so one shape suffices for score work. */
const GRAPH: Graph = {
  nodes: [
    { id: 'driver', label: 'Driver', kind: 'driver', value: 10 },
    { id: 'lever', label: 'Lever', kind: 'lever', value: 5 },
    { id: 'outcome', label: 'Outcome', kind: 'outcome', value: 100 },
  ],
  edges: [
    { from: 'driver', to: 'outcome', weight: 0.5, belief: 0.9 },
    { from: 'lever', to: 'outcome', weight: 0.3, belief: 0.8 },
  ],
} as unknown as Graph;

/** One k value per coverage band the implementation defines (>=1000, 500–999, <500). */
const K_BAND_REPRESENTATIVES = [1000, 700, 100] as const;

/** Every input cell a production call site can construct. */
const DOMAIN = (() => {
  const cells: Array<{ identifiable: boolean; in_linear_range: boolean; k_samples: number }> = [];
  for (const identifiable of [true, false]) {
    for (const in_linear_range of [true, false]) {
      for (const k_samples of K_BAND_REPRESENTATIVES) {
        cells.push({ identifiable, in_linear_range, k_samples });
      }
    }
  }
  return cells;
})();

const badges = () => DOMAIN.map((cell) => calculateConfidence({ graph: GRAPH, ...cell }));

describe('published confidence derives only from named, grounded factors', () => {
  it('the reachable domain is non-empty and exactly the expected size (precondition)', () => {
    // Pinned FIRST: every check below iterates this domain, so a builder that
    // produced nothing would make all of them pass by testing nothing.
    expect(DOMAIN.length).toBe(2 * 2 * K_BAND_REPRESENTATIVES.length);
    expect(DOMAIN.length).toBe(12);
    expect(badges()).toHaveLength(12);
  });

  it('every factor the badge NAMES varies across the reachable domain', () => {
    const observed = badges();
    const keys = Object.keys(observed[0].factors) as Array<keyof (typeof observed)[0]['factors']>;

    expect(keys.length).toBeGreaterThan(0);

    const inert: string[] = [];
    for (const key of keys) {
      const distinct = new Set(observed.map((b) => b.factors[key]));
      if (distinct.size < 2) inert.push(`${String(key)} (constant ${[...distinct][0]})`);
    }

    // A factor that cannot move is not a determinant of the published score.
    expect(inert).toEqual([]);
  });

  it('publishes EXACTLY the three grounded factor keys — no more, no fewer', () => {
    // The derived "every named factor varies" check above and this hand-written
    // key set are NOT redundant, and neither supersedes the other.
    //
    // Derivation cannot prove COMPLETENESS: a fabricated fourth factor that
    // happened to VARY with the request — say a rounding artefact, or a real
    // number borrowed from an unrelated computation — would satisfy the
    // varies-check completely while still telling the caller the score has a
    // determinant it does not have. Only an enumerated set can see that.
    //
    // Conversely this set cannot prove the keys are GROUNDED: it would pass
    // just as happily if all three were pinned constants. Ship both.
    for (const badge of badges()) {
      expect(Object.keys(badge.factors).sort()).toEqual([
        'identifiability',
        'k_coverage',
        'linearity_distance',
      ]);
    }
  });

  it('the published scale is fully attainable — a best-case graph scores exactly 1', () => {
    // Identifiable, inside the linear range, fully sampled. If any share of the
    // weight budget is pinned to a value the request cannot influence, the top
    // of the documented 0–1 range is unreachable and this REDs.
    const best = calculateConfidence({
      graph: GRAPH,
      identifiable: true,
      in_linear_range: true,
      k_samples: 1000,
    });

    expect(best.score).toBe(1);
    expect(best.level).toBe('HIGH');
  });

  it('every published score sits inside the documented 0–1 range', () => {
    for (const badge of badges()) {
      expect(badge.score).toBeGreaterThanOrEqual(0);
      expect(badge.score).toBeLessThanOrEqual(1);
    }
  });

  it('score is strictly monotonic in each factor, holding the others fixed', () => {
    // Grounding is directional as well as present: improving a determinant must
    // never lower the published score.
    for (const in_linear_range of [true, false]) {
      for (const k_samples of K_BAND_REPRESENTATIVES) {
        const yes = calculateConfidence({ graph: GRAPH, identifiable: true, in_linear_range, k_samples });
        const no = calculateConfidence({ graph: GRAPH, identifiable: false, in_linear_range, k_samples });
        expect(yes.score).toBeGreaterThan(no.score);
      }
    }

    for (const identifiable of [true, false]) {
      for (const k_samples of K_BAND_REPRESENTATIVES) {
        const inRange = calculateConfidence({ graph: GRAPH, identifiable, in_linear_range: true, k_samples });
        const outRange = calculateConfidence({ graph: GRAPH, identifiable, in_linear_range: false, k_samples });
        expect(inRange.score).toBeGreaterThan(outRange.score);
      }
    }

    for (const identifiable of [true, false]) {
      for (const in_linear_range of [true, false]) {
        const high = calculateConfidence({ graph: GRAPH, identifiable, in_linear_range, k_samples: 1000 });
        const mid = calculateConfidence({ graph: GRAPH, identifiable, in_linear_range, k_samples: 700 });
        const low = calculateConfidence({ graph: GRAPH, identifiable, in_linear_range, k_samples: 100 });
        expect(high.score).toBeGreaterThan(mid.score);
        expect(mid.score).toBeGreaterThan(low.score);
      }
    }
  });
});

/**
 * The complete published output map: LEVEL **and SCORE**, cell by cell.
 *
 * WHY THE SCORE COLUMN IS LOAD-BEARING, not decoration (measured, #327 review).
 * An earlier version of this table pinned only the level. Every other assertion
 * in this file is a PROPERTY — levels preserved, best case scores 1, monotonic
 * in each factor, inside 0–1 — and properties bound a space rather than a point.
 * The reviewer enumerated it: **2,419 distinct weightings that sum to 1000 pass
 * every one of those assertions while publishing DIFFERENT numbers to users.**
 * The suite would have been fully green for any of them.
 *
 * That is the whole defect class this change exists to close, one level up: a
 * published number that nothing pins can drift without any guard objecting. So
 * the exact score is pinned per cell, keyed by IDENTITY (the three input names),
 * never by a value another cell could satisfy.
 *
 * A deliberate consequence: ANY reweighting or threshold change now REDs here,
 * including a well-intentioned one. That is intended — a change to published
 * confidence numbers must be argued for and re-derived, not absorbed silently.
 * The blessed snapshot at contracts/snapshots/report.v1.example.json pins the
 * same arithmetic independently, through the real HTTP route.
 */
const EXPECTED_OUTPUT: Array<{
  identifiable: boolean;
  in_linear_range: boolean;
  k_samples: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
}> = [
  { identifiable: true, in_linear_range: true, k_samples: 1000, level: 'HIGH', score: 1 },
  { identifiable: true, in_linear_range: true, k_samples: 700, level: 'HIGH', score: 0.91 },
  { identifiable: true, in_linear_range: true, k_samples: 100, level: 'HIGH', score: 0.79 },
  { identifiable: true, in_linear_range: false, k_samples: 1000, level: 'HIGH', score: 0.85 },
  { identifiable: true, in_linear_range: false, k_samples: 700, level: 'MEDIUM', score: 0.77 },
  { identifiable: true, in_linear_range: false, k_samples: 100, level: 'MEDIUM', score: 0.65 },
  { identifiable: false, in_linear_range: true, k_samples: 1000, level: 'MEDIUM', score: 0.71 },
  { identifiable: false, in_linear_range: true, k_samples: 700, level: 'MEDIUM', score: 0.62 },
  { identifiable: false, in_linear_range: true, k_samples: 100, level: 'MEDIUM', score: 0.51 },
  { identifiable: false, in_linear_range: false, k_samples: 1000, level: 'MEDIUM', score: 0.57 },
  { identifiable: false, in_linear_range: false, k_samples: 700, level: 'LOW', score: 0.48 },
  { identifiable: false, in_linear_range: false, k_samples: 100, level: 'LOW', score: 0.36 },
];

describe('renormalisation preserves every user-facing level and pins every score', () => {
  it('covers the whole domain (precondition)', () => {
    expect(EXPECTED_OUTPUT).toHaveLength(DOMAIN.length);
    // Each cell distinct: a duplicated row would silently shrink the coverage
    // this table claims while the length check still agreed.
    const keys = EXPECTED_OUTPUT.map(
      (e) => `${e.identifiable}|${e.in_linear_range}|${e.k_samples}`
    );
    expect(new Set(keys).size).toBe(EXPECTED_OUTPUT.length);
  });

  it.each(EXPECTED_OUTPUT)(
    'identifiable=$identifiable in_linear_range=$in_linear_range k=$k_samples → $level $score',
    ({ identifiable, in_linear_range, k_samples, level, score }) => {
      const badge = calculateConfidence({ graph: GRAPH, identifiable, in_linear_range, k_samples });
      expect(badge.level).toBe(level);
      expect(badge.score).toBe(score);
    }
  );
});
