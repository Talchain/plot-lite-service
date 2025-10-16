import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Prometheus /metrics (C4)', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.PROMETHEUS_ENABLE;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PROMETHEUS_ENABLE = origEnv;
    } else {
      delete process.env.PROMETHEUS_ENABLE;
    }
  });

  it('/metrics exists only with PROMETHEUS_ENABLE=1', async () => {
    process.env.PROMETHEUS_ENABLE = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    
    await app.close();
  });

  it('/metrics absent when flag OFF', async () => {
    delete process.env.PROMETHEUS_ENABLE;
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
    
    await app.close();
  });

  it('/metrics includes key gauges', async () => {
    process.env.PROMETHEUS_ENABLE = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;
    
    expect(body).toContain('engine_p95_ms');
    expect(body).toContain('engine_p95_ms_rolling');
    expect(body).toContain('json_429_total');
    expect(body).toContain('sse_429_total');
    expect(body).toContain('idem_cache_size');
    expect(body).toContain('# HELP');
    expect(body).toContain('# TYPE');
    
    await app.close();
  });
});

describe('/openapi.json Rate Limit (C4)', () => {
  it('allows first 10 requests', async () => {
    process.env.OPENAPI_DEV = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).not.toBe(429);
    }
    
    await app.close();
    delete process.env.OPENAPI_DEV;
  });

  it('11th request returns 429', async () => {
    process.env.OPENAPI_DEV = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    // First 10
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: 'GET', url: '/openapi.json' });
    }
    
    // 11th
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
    
    await app.close();
    delete process.env.OPENAPI_DEV;
  });
});
