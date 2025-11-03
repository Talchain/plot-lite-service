import { describe, it, expect } from 'vitest';
import { getInferenceEngine } from '../src/inference/index.js';

describe('Inference Parity', () => {
  const graph = {
    nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
    edges: [{ from: 'A', to: 'B', weight: 1.5, belief: 0.9 }],
  };
  
  const config = { seed: 4242, k_samples: 200, outcome_node: 'B', baseline_value: 100 };

  it('both modes produce identical results (parity)', () => {
    const mb = getInferenceEngine('model_based').run(graph, config);
    const moi = getInferenceEngine('model_of_inference').run(graph, config);
    
    expect(mb.conservative.outcome).toBe(moi.conservative.outcome);
    expect(mb.most_likely.outcome).toBe(moi.most_likely.outcome);
    expect(mb.optimistic.outcome).toBe(moi.optimistic.outcome);
  });

  it('deterministic with same seed', () => {
    const r1 = getInferenceEngine('model_based').run(graph, config);
    const r2 = getInferenceEngine('model_based').run(graph, config);
    
    expect(r1.conservative.outcome).toBe(r2.conservative.outcome);
  });
});
