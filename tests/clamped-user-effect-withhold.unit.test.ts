/** AI Quality #72 5893355501 — pure rows for `clampedEffects` (the route rows are in clamped-user-effect-withhold.route.test.ts). */
import { describe, it, expect } from 'vitest';
import { clampedEffects, clampedEffectWithheldMessage, clampedEffectDisclosedMessage } from '../src/lib/goal-identity-withhold.js';
import { normaliseEdge } from '../src/normalisation/graph-normaliser.js';
import { toISLEdge } from '../src/integrations/isl/translator-v3.js';

const graph = (edges: any[]) => ({
  nodes: [
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'factor', label: 'Paying subscribers' },
    { id: 'mrr', kind: 'goal', label: 'MRR' }, { id: 'tickets', kind: 'outcome', label: 'Support tickets' },
  ],
  edges: [{ from: 'price', to: 'subs', strength: { mean: -0.4 } }, ...edges],
});
const user = { source: 'brief_extraction', magnitude: 'user_stated' };

describe('clampedEffects — which cut sizes withhold and which are only said', () => {
  it('a historically cut user-stated size on the goal path → withhold', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1, clamped_from: 4.61 }, provenance: user }]));
    expect(r.withhold.map((c) => [c.from, c.to, c.clamped_from])).toEqual([['subs', 'mrr', 4.61]]);
    expect(r.disclose).toEqual([]);
  });
  it("provenance.source 'user_specified' counts as the user's", () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: -1, clamped_from: -2 }, provenance: { source: 'user_specified' } }]));
    expect(r.withhold).toHaveLength(1);
  });
  it('the marker alone (mean 1, clamped_from 4.61) → withhold, reporting the stated size', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1, clamped_from: 4.61 }, provenance: user }]));
    expect(r.withhold.map((c) => c.clamped_from)).toEqual([4.61]);
  });
  it('user-stated but OFF the goal path → disclose only', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'tickets', strength: { mean: 1, clamped_from: 3 }, provenance: user }]));
    expect(r.withhold).toEqual([]);
    expect(r.disclose.map((c) => [c.to, c.user_stated, c.on_goal_path])).toEqual([['tickets', true, false]]);
  });
  it('an Olumi estimate / placeholder / unlabelled size on the goal path → disclose only', () => {
    for (const provenance of [{ magnitude: 'olumi_estimate' }, { magnitude: 'olumi_placeholder' }, undefined]) {
      const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1, clamped_from: 4.61 }, provenance }]));
      expect(r.withhold, JSON.stringify(provenance)).toEqual([]);
      expect(r.disclose, JSON.stringify(provenance)).toHaveLength(1);
    }
  });
  it('an uncut finite coefficient above one is not a clamp, for either author or sign', () => {
    for (const mean of [2.7, 1.08, -4.61, 40]) for (const provenance of [user, { magnitude: 'olumi_estimate' }]) {
      expect(clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean }, provenance }]))).toEqual({ withhold: [], disclose: [] });
    }
  });
  it('CONTROL: in range (|mean| ≤ 1, no marker) → nothing', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1 }, provenance: user }, { from: 'price', to: 'mrr', strength: { mean: -1 }, provenance: user }]));
    expect(r).toEqual({ withhold: [], disclose: [] });
  });
  it('words: one link and two links', () => {
    const one = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1, clamped_from: 4.61 }, provenance: user }])).withhold;
    expect(clampedEffectWithheldMessage(one)).toBe("Not shown. Your size for how ‘Paying subscribers’ moves ‘MRR’ is bigger than this model's scale can hold, so the run couldn't use it at full size, and the figures that depend on it would be wrong.");
    const two = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1, clamped_from: 4.61 }, provenance: user }, { from: 'price', to: 'mrr', strength: { mean: -1, clamped_from: -3 }, provenance: user }])).withhold;
    expect(clampedEffectWithheldMessage(two)).toMatch(/^Not shown\. Your size for how ‘Paying subscribers’ moves ‘MRR’ and how ‘Price’ moves ‘MRR’ are bigger .* use them at full size, and the figures that depend on them would be wrong\.$/);
    const off = clampedEffects(graph([{ from: 'subs', to: 'tickets', strength: { mean: 1, clamped_from: 3 }, provenance: user }])).disclose;
    expect(clampedEffectDisclosedMessage(off)).toBe("Your size for how ‘Paying subscribers’ moves ‘Support tickets’ is bigger than this model's scale can hold, so the run used it capped at the model's limit.");
  });
});

// Same frame conversion the core mapper declares; no runtime framing workaround.
// Source frame 2, target frame 3, beta +/-2 per raw source unit: +2 raw units -> +/-4.

it.each([1, -1])('preserves signed size %s and its SD on the actual ISL wire', (sign) => {
  const mean = sign * 2 * 2 / 3;
  const std = 0.2 * 2 / 3;
  const warnings: any[] = [];
  const edge = normaliseEdge({ from: 'x', to: 'y', strength: { mean, std }, exists_probability: 1,
    provenance: { source: 'brief_extraction', magnitude: 'user_stated' } } as never,
  0, new Map([['x', 'factor'], ['y', 'goal']]), warnings);
  const wire = toISLEdge(edge);
  expect(wire.strength).toEqual({ mean, std });
  expect(wire.strength.mean * (2 / 2) * 3).toBeCloseTo(sign * 4, 12);
  expect(warnings.some((w) => w.code === 'CLAMP_STRENGTH_MEAN')).toBe(false);
});

it('still bounds a legacy weight rating and reports that repair', () => {
  const warnings: any[] = [];
  const edge = normaliseEdge({ from: 'x', to: 'y', weight: 2 } as never, 0, new Map(), warnings);
  expect(edge.strength.mean).toBe(1);
  expect(warnings.some((w) => w.code === 'CLAMP_STRENGTH_MEAN')).toBe(true);
});
