import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Identifiability Tag Determinism', () => {
  it('golden payload produces stable hashes', async () => {
    process.env.IDENT_TAG_ENABLE = '1';
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
    };
    
    const hashes = new Set();
    const bmaHashes = new Set();
    
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload,
      });
      const body = JSON.parse(res.body);
      hashes.add(body.model_card.response_hash);
      if (body.model_card.bma_hash) {
        bmaHashes.add(body.model_card.bma_hash);
      }
    }
    
    expect(hashes.size).toBe(1); // one unique response_hash
    expect(bmaHashes.size).toBeLessThanOrEqual(1); // one unique bma_hash if present
    
    await app.close();
    delete process.env.IDENT_TAG_ENABLE;
  });
});
