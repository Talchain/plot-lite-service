import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('/v1/limits', () => {
  let server: ServerHandle | null = null;
  afterEach(async () => { await server?.kill(); server = null; });
  
  it('returns configured limits', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/limits`);
    expect(r.status).toBe(200);
    expect(r.data.nodes.max).toBeDefined();
    expect(r.data.edges.max).toBeDefined();
  });
});
