import { describe, it, expect } from 'vitest';
import { buildExplainDelta } from '../src/trust/explain-delta.js';

describe('Explain-Δ summary includes identifiability method (no shape change)', () => {
  it('appends method tag deterministically', () => {
    const graph = {
      nodes: [
        { id: 't', label: 'T' },
        { id: 'y', label: 'Y' },
      ],
      edges: [{ from: 't', to: 'y' }],
    };
    const res = buildExplainDelta({
      graph,
      baseline_outcome: 100,
      counterfactual_outcome: 120,
      seed: 42,
      top_n: 2,
      identifiability_method: 'backdoor',
    });
    expect(typeof res.summary).toBe('string');
    expect(res.summary).toMatch(/identifiability: backdoor/);
  });
});
