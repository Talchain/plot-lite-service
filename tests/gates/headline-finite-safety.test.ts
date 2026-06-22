/**
 * SCIENTIFIC REGRESSION GATE — WP5 (headlines): finite-safe ranking + copy
 * ----------------------------------------------------------------------------
 * Pure-function unit pins on `generateHeadlines` (src/coaching/headlines.ts).
 *
 * Protects two honesty invariants for the user-facing m1_coaching headlines when
 * an ISL Monte Carlo run yields a non-finite win probability (NaN / ±Infinity):
 *   A. RANKING is finite-safe — an invalid option is never crowned "winner"
 *      merely because NaN comparisons make the sort order ambiguous. A finite
 *      option wins whenever one exists.
 *   B. COPY is finite-safe — no headline ever renders "... by Infinity points"
 *      or any "Infinity"/"NaN" token. A non-finite margin falls back to an
 *      honest, number-free string.
 *
 * Finite edge values (0, a tiny positive margin, and 1) are pinned to prove the
 * guards fire ONLY on non-finite input and never suppress legitimate numbers.
 *
 * Background: the prior WP5 change guarded only the runner-up label; the winner
 * headline (deltaPoints) and the sort were still non-finite-unsafe — Codex
 * reproduced "Bad outperforms by Infinity points with high confidence".
 */

import { describe, it, expect } from 'vitest';
import { generateHeadlines } from '../../src/coaching/headlines.js';
import type { CoachingInputs, NormalisedOption } from '../../src/coaching/types.js';

function opt(id: string, label: string, winProbability: number): NormalisedOption {
  return { id, label, winProbability, outcomeMean: 0.5, outcomeP10: 0.4, outcomeP90: 0.6 };
}

function makeInputs(options: NormalisedOption[]): CoachingInputs {
  return {
    options,
    // One factor so `hasFactorSensitivity` is true (avoids the needs_evidence
    // short-circuit and exercises the winProbDelta-driven headline path).
    factorSensitivity: [
      {
        node_id: 'f',
        label: 'Factor F',
        elasticity: 0.5,
        importance_rank: 1,
        confidence: 0.8,
        direction: 'positive',
        influence_score: 0.5,
        zero_reason: undefined,
      },
    ],
    fragileEdges: [],
    robustness: { level: 'high', recommendationStability: 0.9, isRobust: true },
    graph: { nodes: [], edges: [] } as unknown as CoachingInputs['graph'],
  };
}

/** Every headline string must be free of non-finite tokens. */
function assertNoNonFiniteCopy(headlines: Record<string, string>) {
  for (const [id, text] of Object.entries(headlines)) {
    expect(text, `headline for ${id}`).not.toMatch(/Infinity|NaN/);
  }
}

/** No headline may assert a RANK (leads / outperforms / edges ahead / Runner-up) —
 *  used when the comparison is invalid, where rank is unknowable. */
function assertNoRankClaim(headlines: Record<string, string>) {
  for (const [id, text] of Object.entries(headlines)) {
    expect(text, `headline for ${id}`).not.toMatch(/\bleads\b|outperforms|edges ahead|Runner-up/i);
  }
}

const RANK_NEUTRAL = 'Win probability could not be computed — ranking unavailable';

describe('WP5 headline gate · any non-finite option ⇒ rank-neutral for ALL', () => {
  function assertAllRankNeutral(headlines: Record<string, string>, ids: string[]) {
    assertNoNonFiniteCopy(headlines);
    assertNoRankClaim(headlines); // no "leads"/"outperforms"/"Runner-up" for ANY option
    expect(Object.keys(headlines).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(headlines[id]).toBe(RANK_NEUTRAL);
  }

  it('REGRESSION: an infinite option ⇒ every option is rank-neutral (no "leads"/"Runner-up")', () => {
    const headlines = generateHeadlines(makeInputs([opt('bad', 'Bad', Number.POSITIVE_INFINITY), opt('good', 'Good', 0.6)]));
    assertAllRankNeutral(headlines, ['bad', 'good']);
  });

  it('REGRESSION: a NaN runner-up ⇒ every option is rank-neutral', () => {
    const headlines = generateHeadlines(makeInputs([opt('good', 'Good', 0.7), opt('bad', 'Bad', Number.NaN)]));
    assertAllRankNeutral(headlines, ['good', 'bad']);
  });

  it('REGRESSION (Codex round-3): [0.7, 0.3, NaN] ⇒ NO option claims a rank (mid is NOT "Runner-up")', () => {
    // The NaN option could actually rank first or second, so neither "Top leads" nor
    // labelling Mid "Runner-up" is justified. Round-2 wrongly kept the finite ranking
    // here; the contract is now: ANY invalid comparison poisons ALL rank claims.
    const headlines = generateHeadlines(makeInputs([opt('top', 'Top', 0.7), opt('mid', 'Mid', 0.3), opt('bad', 'Bad', Number.NaN)]));
    assertAllRankNeutral(headlines, ['top', 'mid', 'bad']);
  });

  it('ALL options non-finite ⇒ every option is rank-neutral', () => {
    const headlines = generateHeadlines(makeInputs([opt('a', 'A', Number.NaN), opt('b', 'B', Number.POSITIVE_INFINITY)]));
    assertAllRankNeutral(headlines, ['a', 'b']);
  });
});

describe('WP5 headline gate · finite edge values are NOT suppressed', () => {
  it('win probabilities 1 and 0 render a numeric headline (guard fires only on non-finite)', () => {
    const headlines = generateHeadlines(makeInputs([opt('win', 'Win', 1), opt('lose', 'Lose', 0)]));
    assertNoNonFiniteCopy(headlines);
    // Winner is the finite 1.0 option; margin is a real number (100 points), not suppressed.
    expect(headlines['win']).toMatch(/\d/);
    expect(headlines['win']).not.toBe('Runner-up');
    expect(headlines['lose']).toBe('Runner-up with 0% win probability');
  });

  it('a tiny positive margin renders finite copy (no Infinity/NaN, winner is finite)', () => {
    const headlines = generateHeadlines(makeInputs([opt('a', 'A', 0.5005), opt('b', 'B', 0.5)]));
    assertNoNonFiniteCopy(headlines);
    expect(headlines['a']).toBeDefined();
    expect(headlines['a']).not.toBe('Runner-up');
  });

  it('all-zero win probabilities render finite copy', () => {
    const headlines = generateHeadlines(makeInputs([opt('a', 'A', 0), opt('b', 'B', 0)]));
    assertNoNonFiniteCopy(headlines);
    expect(Object.keys(headlines)).toContain('a');
    expect(Object.keys(headlines)).toContain('b');
  });
});
