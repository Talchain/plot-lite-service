import { describe, it, expect } from 'vitest';
import { computeAdaptiveK, determineK } from '../src/kernel/adaptive-k.js';
import { createServer } from '../src/createServer.js';

describe('Adaptive K: docs + tests sanity (ADAPTIVE_K_ENABLE=1)', () => {
  it('small graph: 3 nodes, 2 edges', () => {
    const result = computeAdaptiveK(3, 2);
    // K = 250 + 25*2 + 10*3 = 250 + 50 + 30 = 330
    expect(result.k_samples).toBe(330);
    expect(result.clamped).toBe(false);
    expect(result.reason).toContain('330');
  });

  it('medium graph: 10 nodes, 15 edges', () => {
    const result = computeAdaptiveK(10, 15);
    // K = 250 + 25*15 + 10*10 = 250 + 375 + 100 = 725
    expect(result.k_samples).toBe(725);
    expect(result.clamped).toBe(false);
  });

  it('max clamp: 100 nodes, 100 edges', () => {
    const result = computeAdaptiveK(100, 100);
    // K = 250 + 25*100 + 10*100 = 250 + 2500 + 1000 = 3750 → clamped to 1000
    expect(result.k_samples).toBe(1000);
    expect(result.clamped).toBe(true);
    expect(result.reason).toContain('maximum');
  });

  it('explicit K in request wins over adaptive', () => {
    const result = determineK(10, 10, 500);
    expect(result.k_samples).toBe(500);
    expect(result.reason).toContain('User-specified');
  });

  it('determinism: 10 runs with same input produce same hash', async () => {
    process.env.ADAPTIVE_K_ENABLE = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    const payload = {
      seed: 4242,
      graph: {
        nodes: [
          { id: 'Price', label: 'Price' },
          { id: 'Demand', label: 'Demand' },
          { id: 'Revenue', label: 'Revenue' },
        ],
        edges: [
          { from: 'Price', to: 'Demand', weight: -0.5, belief: 0.8 },
          { from: 'Demand', to: 'Revenue', weight: 0.8, belief: 0.9 },
        ],
      },
      outcome_node: 'Revenue',
      // Omit k_samples to trigger adaptive K
    };
    
    const hashes = new Set();
    
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload,
      });
      const body = JSON.parse(res.body);
      hashes.add(body.model_card.response_hash);
    }
    
    expect(hashes.size).toBe(1); // one unique hash
    
    await app.close();
    delete process.env.ADAPTIVE_K_ENABLE;
  });
});
