import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('P0: result fields', () => {
  let server: ServerHandle | null = null;
  afterEach(async () => { await server?.kill(); server = null; });
  
  it('returns result.response_hash, summary, top_drivers', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'Start' }, { id: 'B', label: 'End' }], edges: [{ from: 'A', to: 'B', weight: 1 }] },
        seed: 42
      }),
    });
    expect(r.status).toBe(200);
    expect(r.data.result.response_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.data.result.summary.p10).toBeDefined();
    expect(r.data.result.summary.p50).toBeDefined();
    expect(r.data.result.summary.p90).toBeDefined();
    expect(r.data.explain_delta.top_edge_drivers).toBeInstanceOf(Array);
    expect(r.data.explain_delta.top_edge_drivers.length).toBeGreaterThan(0);
    expect(r.data.model_card.response_hash).toBeDefined();
  });
});
