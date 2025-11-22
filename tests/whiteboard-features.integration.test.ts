import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Phase-B Integration (all flags ON)', () => {
  let origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv = { ...process.env };
    // Enable all Phase-B flags
    process.env.IDENT_TAG_ENABLE = '1';
    process.env.PROVENANCE_ENABLE = '1';
    process.env.ADAPTIVE_K_ENABLE = '1';
    process.env.CONFIDENCE_CALIBRATED = '1';
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('features compose without errors', async () => {
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
    
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload,
    });
    
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    
    // Core response structure intact
    expect(body.model_card).toBeDefined();
    expect(body.model_card.response_hash).toBeDefined();
    expect(body.results).toBeDefined();
    
    // No schema drift - all new fields are optional/flag-gated
    
    await app.close();
  });

  it('10× determinism: same hashes with all flags ON', async () => {
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
  });
});
