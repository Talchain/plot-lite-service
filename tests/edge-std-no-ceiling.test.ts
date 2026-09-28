/**
 * ⭐ AIQ RULING (olumi-programme-docs#72 5869431686 §2): PLoT does NOT ceiling an edge's std.
 *
 * ⛔ THE DEFECT. `graph-normaliser.ts` clamped every edge std into [floor, 0.4]. CEE's own rule gives std 0.5 at
 * |mean| 1, and 6 distinct served edges carry exactly that across 202 captured request graphs (e.g. churn →
 * subscribers −1 ± 0.5). Each lost 20% of its stated spread, so the answer looked more certain than the model
 * believes. ISL needs only std > 0.001 (`Field(gt=0.001)`), so there is no engine reason for a ceiling.
 *
 * SPEC: no ceiling · the floor stays (MG D12 proportional causal floor, structural 0.01, ISL's 0.0011 — PLoT #387)
 * · the ±1 clamp on the MEAN stays (a system contract: CEE StrengthSchema, CEE clamp, PLoT clamp).
 * The route-level row on A's served price twin is `edge-std-no-ceiling.route.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { normaliseEdge, type NormalisationWarning } from '../src/normalisation/graph-normaliser.js';
import { REPAIR_CODES } from '../src/normalisation/repair-codes.js';

const causal = new Map([['A', 'factor'], ['B', 'factor']]);
const structural = new Map([['O', 'option'], ['F', 'factor']]);
const run = (strength: { mean: number; std: number }, kinds = causal, from = 'A', to = 'B') => {
  const warnings: NormalisationWarning[] = [];
  const edge = normaliseEdge({ from, to, strength } as never, 0, kinds, warnings);
  return { std: edge.strength.std, mean: edge.strength.mean, warnings };
};
const stdClamps = (w: NormalisationWarning[]) => w.filter((x) => x.code === REPAIR_CODES.CLAMP_STRENGTH_STD);

describe('AIQ 5869431686 §2: an edge std above 0.4 reaches ISL as stated', () => {
  it('RED: CEE\'s |mean| 1 edge keeps std 0.5 (was cut to 0.4), with no CLAMP_STRENGTH_STD repair', () => {
    const r = run({ mean: 1, std: 0.5 });
    expect(r.mean).toBe(1);
    expect(r.std).toBe(0.5);
    expect(stdClamps(r.warnings)).toEqual([]);
  });

  it('RED: the served churn → subscribers shape, −1 ± 0.5, keeps 0.5', () => {
    const r = run({ mean: -1, std: 0.5 });
    expect(r.mean).toBe(-1);
    expect(r.std).toBe(0.5);
    expect(stdClamps(r.warnings)).toEqual([]);
  });

  it('RED: a wide stated spread is not narrowed — {0.5, 0.8} keeps 0.8', () => {
    const r = run({ mean: 0.5, std: 0.8 });
    expect(r.std).toBe(0.8);
    expect(stdClamps(r.warnings)).toEqual([]);
  });

  it('CONTROL (floor, D12, unchanged): {−0.5, 0.02} still floors to 0.05 with CLAMP_STRENGTH_STD on that edge', () => {
    const r = run({ mean: -0.5, std: 0.02 });
    expect(r.std).toBe(0.05);
    const c = stdClamps(r.warnings);
    expect(c).toHaveLength(1);
    expect(c[0].edge_id).toBe('A::B');
    expect(c[0].repair).toMatchObject({ field: 'edge.strength.std', action: 'clamped', from_value: 0.02, to_value: 0.05 });
  });

  it('CONTROL (ISL floor, #387, unchanged): a zero std on a zero mean floors to 0.0011, strictly above ISL\'s 0.001', () => {
    expect(run({ mean: 0, std: 0 }).std).toBe(0.0011);
  });

  it('CONTROL (structural floor, unchanged): option -> factor {1, 0.005} floors to 0.01', () => {
    expect(run({ mean: 1, std: 0.005 }, structural, 'O', 'F').std).toBe(0.01);
  });

  it('CONTROL (mean contract, unchanged): a mean of 1.5 is still clamped to 1 with CLAMP_STRENGTH_MEAN', () => {
    const r = run({ mean: 1.5, std: 0.5 });
    expect(r.mean).toBe(1);
    expect(r.warnings.filter((x) => x.code === REPAIR_CODES.CLAMP_STRENGTH_MEAN)).toHaveLength(1);
  });
});
