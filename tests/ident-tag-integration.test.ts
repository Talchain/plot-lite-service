import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Identifiability Tag Integration', () => {
  it('tag present when flag ON', async () => {
    process.env.IDENT_TAG_ENABLE = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B' }],
        },
        outcome_node: 'B',
      },
    });
    
    const body = JSON.parse(res.body);
    expect(body.model_card.identifiability_tag).toBeDefined();
    
    await app.close();
    delete process.env.IDENT_TAG_ENABLE;
  });

  it('tag absent when flag OFF', async () => {
    delete process.env.IDENT_TAG_ENABLE;
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B' }],
        },
        outcome_node: 'B',
      },
    });
    
    const body = JSON.parse(res.body);
    expect(body.model_card.identifiability_tag).toBeUndefined();
    
    await app.close();
  });
});
