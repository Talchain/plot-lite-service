import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Prometheus Histograms (H1)', () => {
  let app: any;
  let origFlag: string | undefined;

  beforeAll(async () => {
    origFlag = process.env.PROMETHEUS_ENABLE;
    process.env.PROMETHEUS_ENABLE = '1';
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
    if (origFlag) process.env.PROMETHEUS_ENABLE = origFlag;
    else delete process.env.PROMETHEUS_ENABLE;
  });

  it('/metrics includes histogram buckets', async () => {
    // Warm up with a request
    await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        outcome_node: 'A'
      }
    });

    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);

    const body = res.body;
    expect(body).toContain('engine_latency_ms_bucket');
    expect(body).toContain('engine_latency_ms_sum');
    expect(body).toContain('engine_latency_ms_count');
  });

  it('buckets are monotonic', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.body;

    const bucketLines = body.split('\n').filter((l: string) => 
      l.includes('engine_latency_ms_bucket') && !l.startsWith('#')
    );

    expect(bucketLines.length).toBeGreaterThan(0);
  });

  it('flag OFF returns 404', async () => {
    process.env.PROMETHEUS_ENABLE = '0';
    const app2 = await createServer({ enableTestRoutes: false });
    
    const res = await app2.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
    
    await app2.close();
    process.env.PROMETHEUS_ENABLE = '1';
  });
});
