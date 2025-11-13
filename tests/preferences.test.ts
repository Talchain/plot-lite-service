import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/preferences/fit', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('fits weights from pairwise comparisons', async () => {
    const res = await fetch(`${server.baseUrl}/v1/preferences/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: [
          { winner: 'OptionA', loser: 'OptionB', strength: 1.0 }
        ],
        prior: { weights: { Outcome: 1.0 } }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('preferences.v1');
    expect(data.weights).toBeDefined();
    expect(data.diagnostics.converged).toBe(true);
  });

  it('requires pairs array', async () => {
    const res = await fetch(`${server.baseUrl}/v1/preferences/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prior: { weights: {} }
      })
    });
    
    expect(res.status).toBe(400);
  });

  it('requires prior weights', async () => {
    const res = await fetch(`${server.baseUrl}/v1/preferences/fit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: [{ winner: 'A', loser: 'B', strength: 1 }]
      })
    });
    
    expect(res.status).toBe(400);
  });
});
