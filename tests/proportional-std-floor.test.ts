/**
 * ⭐ MAGNITUDE CONTRACT, PR2 (MG design D12): PLoT's causal std floor is PROPORTIONAL —
 * `min(0.05, max(0.001, |mean| / 2))` — so a correctly sized small effect keeps its own spread.
 *
 * ⛔ THE DEFECT. CEE PR1 now sizes Paul's T3 AI -> churn link at −0.01 / 0.005 on churn's 0–100% frame.
 * The absolute floor lifted σ to 0.05 (5× the mean), so about 22% of the leader's churn draws stayed below
 * 0% (design table, row B). Every edge with |mean| ≥ 0.1 behaves exactly as before (the contrast rows).
 */
import { describe, expect, it } from 'vitest';
import { normaliseEdge, type NormalisationWarning } from '../src/normalisation/graph-normaliser.js';

const causal = new Map([['A', 'factor'], ['B', 'factor']]);
const structural = new Map([['O', 'option'], ['F', 'factor']]);
const run = (strength: { mean: number; std: number }, kinds = causal, from = 'A', to = 'B') => {
  const warnings: NormalisationWarning[] = [];
  const edge = normaliseEdge({ from, to, strength } as never, 0, kinds, warnings);
  return { std: edge.strength.std, mean: edge.strength.mean, warnings };
};

describe('PR2: a causal edge\'s std floor is proportional to its own size', () => {
  it('RED: T3\'s −0.01 / 0.005 keeps 0.005 (was lifted to 0.05), with no CLAMP_STRENGTH_STD repair', () => {
    const r = run({ mean: -0.01, std: 0.005 });
    expect(r.mean).toBe(-0.01);
    expect(r.std).toBe(0.005);
    expect(JSON.stringify(r.warnings)).not.toContain('CLAMP_STRENGTH_STD');
  });

  it('RED: a spread below HALF a small mean floors to |mean|/2, never to 0.05', () => {
    expect(run({ mean: -0.02, std: 0.001 }).std).toBe(0.01);
  });

  it('CONTRAST: |mean| ≥ 0.1 floors exactly as before — {−0.5, 0.02} → 0.05', () => {
    const r = run({ mean: -0.5, std: 0.02 });
    expect(r.std).toBe(0.05);
    expect(JSON.stringify(r.warnings)).toContain('CLAMP_STRENGTH_STD');
  });

  it('CONTRAST: the boundary |mean| = 0.1 floors to 0.05, as before', () => {
    expect(run({ mean: 0.1, std: 0.01 }).std).toBe(0.05);
  });

  it('a zero mean keeps ISL\'s technical minimum (std > 0): 0.001', () => {
    expect(run({ mean: 0, std: 0 }).std).toBe(0.001);
  });

  it('structural edges are unchanged: option -> factor still floors to 0.01', () => {
    expect(run({ mean: 0.01, std: 0.001 }, structural, 'O', 'F').std).toBe(0.01);
  });
});
