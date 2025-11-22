import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('/v1/validate', () => {
  let server: ServerHandle | null = null;
  afterEach(async () => { await server?.kill(); server = null; });
  
  it('valid payload returns valid:true', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: [{ id: 'A', label: 'Test' }], edges: [] } }),
    });
    expect(r.status).toBe(200);
    expect(r.data.valid).toBe(true);
  });
});
