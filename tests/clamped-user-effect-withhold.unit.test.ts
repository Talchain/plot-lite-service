/** AI Quality #72 5893355501 — pure rows for `clampedEffects` (the route rows are in clamped-user-effect-withhold.route.test.ts). */
import { describe, it, expect } from 'vitest';
import { clampedEffects, clampedEffectWithheldMessage, clampedEffectDisclosedMessage } from '../src/lib/goal-identity-withhold.js';

const graph = (edges: any[]) => ({
  nodes: [
    { id: 'price', kind: 'factor', label: 'Price' }, { id: 'subs', kind: 'factor', label: 'Paying subscribers' },
    { id: 'mrr', kind: 'goal', label: 'MRR' }, { id: 'tickets', kind: 'outcome', label: 'Support tickets' },
  ],
  edges: [{ from: 'price', to: 'subs', strength: { mean: -0.4 } }, ...edges],
});
const user = { source: 'brief_extraction', magnitude: 'user_stated' };

describe('clampedEffects — which cut sizes withhold and which are only said', () => {
  it('user-stated, on the goal path, |mean| > 1 → withhold', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 4.61 }, provenance: user }]));
    expect(r.withhold.map((c) => [c.from, c.to, c.clamped_from])).toEqual([['subs', 'mrr', 4.61]]);
    expect(r.disclose).toEqual([]);
  });
  it("provenance.source 'user_specified' counts as the user's", () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: -2 }, provenance: { source: 'user_specified' } }]));
    expect(r.withhold).toHaveLength(1);
  });
  it('the marker alone (mean 1, clamped_from 4.61) → withhold, reporting the stated size', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1, clamped_from: 4.61 }, provenance: user }]));
    expect(r.withhold.map((c) => c.clamped_from)).toEqual([4.61]);
  });
  it('user-stated but OFF the goal path → disclose only', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'tickets', strength: { mean: 3 }, provenance: user }]));
    expect(r.withhold).toEqual([]);
    expect(r.disclose.map((c) => [c.to, c.user_stated, c.on_goal_path])).toEqual([['tickets', true, false]]);
  });
  it('an Olumi estimate / placeholder / unlabelled size on the goal path → disclose only', () => {
    for (const provenance of [{ magnitude: 'olumi_estimate' }, { magnitude: 'olumi_placeholder' }, undefined]) {
      const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 4.61 }, provenance }]));
      expect(r.withhold, JSON.stringify(provenance)).toEqual([]);
      expect(r.disclose, JSON.stringify(provenance)).toHaveLength(1);
    }
  });
  it('CONTROL: in range (|mean| ≤ 1, no marker) → nothing', () => {
    const r = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 1 }, provenance: user }, { from: 'price', to: 'mrr', strength: { mean: -1 }, provenance: user }]));
    expect(r).toEqual({ withhold: [], disclose: [] });
  });
  it('words: one link and two links', () => {
    const one = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 4.61 }, provenance: user }])).withhold;
    expect(clampedEffectWithheldMessage(one)).toBe("Not shown. Your size for how ‘Paying subscribers’ moves ‘MRR’ is bigger than this model's scale can hold, so the run couldn't use it at full size, and the figures that depend on it would be wrong.");
    const two = clampedEffects(graph([{ from: 'subs', to: 'mrr', strength: { mean: 4.61 }, provenance: user }, { from: 'price', to: 'mrr', strength: { mean: -3 }, provenance: user }])).withhold;
    expect(clampedEffectWithheldMessage(two)).toMatch(/^Not shown\. Your size for how ‘Paying subscribers’ moves ‘MRR’ and how ‘Price’ moves ‘MRR’ are bigger .* use them at full size, and the figures that depend on them would be wrong\.$/);
    const off = clampedEffects(graph([{ from: 'subs', to: 'tickets', strength: { mean: 3 }, provenance: user }])).disclose;
    expect(clampedEffectDisclosedMessage(off)).toBe("Your size for how ‘Paying subscribers’ moves ‘Support tickets’ is bigger than this model's scale can hold, so the run used it capped at the model's limit.");
  });
});
