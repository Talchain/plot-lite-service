import { describe, it, expect, afterEach } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';
import { LIMITS } from '../src/constants/limits.js';

describe('/v1/limits', () => {
  let server: ServerHandle | null = null;
  afterEach(async () => { await server?.kill(); server = null; });

  it('returns configured limits', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/limits`);
    expect(r.status).toBe(200);
    expect(r.data.schema).toBe('limits.v1');
    expect(r.data.max_nodes).toBeDefined();
    expect(r.data.max_edges).toBeDefined();
    expect(r.data.max_body_kb).toBeDefined();
  });

  it('response matches LIMITS constant (contract test)', async () => {
    server = await spawnServer({ env: { TEST_ROUTES: '1', AUTH_ENABLED: '0' } });
    const r = await requestJSON(`${server.baseUrl}/v1/limits`);

    expect(r.status).toBe(200);
    // Verify /v1/limits response matches single source of truth
    expect(r.data.max_nodes).toBe(LIMITS.MAX_NODES);
    expect(r.data.max_edges).toBe(LIMITS.MAX_EDGES);
    expect(r.data.max_options).toBe(LIMITS.MAX_OPTIONS);
  });
});
