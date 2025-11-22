import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Governance endpoints', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ env: { TEST_ROUTES: '1' } }); });
  afterAll(async () => { await server.kill(); });

  it('exposes /__governance__/versions when TEST_ROUTES=1', async () => {
    const res = await fetch(`${server.baseUrl}/__governance__/versions`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('governance.v1');
    expect(data.versions).toBeDefined();
    expect(data.versions.engine_version).toBeDefined();
    expect(data.versions.contract_version).toBeDefined();
    expect(data.versions.model_version).toBeDefined();
  });

  it('includes feature flags', async () => {
    const res = await fetch(`${server.baseUrl}/__governance__/versions`);
    const data = await res.json();
    expect(data.feature_flags).toBeDefined();
    expect(data.feature_flags.TEST_ROUTES).toBe('1');
  });

  it('includes audit stats', async () => {
    const res = await fetch(`${server.baseUrl}/__governance__/versions`);
    const data = await res.json();
    expect(data.audit).toBeDefined();
    expect(data.audit.max_entries).toBe(100);
  });
});
