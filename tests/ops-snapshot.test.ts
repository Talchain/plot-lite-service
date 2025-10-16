import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('/ops/snapshot (H2)', () => {
  let app: any;
  let origFlag: string | undefined;

  beforeAll(async () => {
    origFlag = process.env.OPS_SNAPSHOT_ENABLE;
    process.env.OPS_SNAPSHOT_ENABLE = '1';
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
    if (origFlag) process.env.OPS_SNAPSHOT_ENABLE = origFlag;
    else delete process.env.OPS_SNAPSHOT_ENABLE;
  });

  it('returns operational snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/ops/snapshot' });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('flags');
    expect(body).toHaveProperty('health');
    expect(body).toHaveProperty('cache_stats');
  });

  it('no raw tokens in snapshot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ops/snapshot',
      headers: { authorization: 'Bearer secret-token-123' }
    });

    const body = JSON.parse(res.body);
    const str = JSON.stringify(body);
    
    expect(str).not.toContain('secret-token-123');
    expect(str).not.toContain('Bearer secret');
  });

  it('flag OFF returns 404', async () => {
    process.env.OPS_SNAPSHOT_ENABLE = '0';
    const app2 = await createServer({ enableTestRoutes: false });
    
    const res = await app2.inject({ method: 'GET', url: '/ops/snapshot' });
    expect(res.statusCode).toBe(404);
    
    await app2.close();
    process.env.OPS_SNAPSHOT_ENABLE = '1';
  });
});
