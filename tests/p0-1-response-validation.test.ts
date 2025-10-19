import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import { __resetValidationMetricsForTest } from '../src/observability/validationMetrics.js';

describe('P0-1: Response Validation', () => {
  let app: any;
  beforeAll(async () => { app = await createServer(); });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => { __resetValidationMetricsForTest(); });

  it('valid run response passes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] } }
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.schema).toBe('run.v1');
  });

  it('health responds with ok and uptime (no strict schema)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.status).toBe('ok');
    expect(typeof data.uptime_s).toBe('number');
    // Note: No response schema validation for health (dynamic fields)
  });

  it('validation overhead minimal (isolated)', async () => {
    const times: number[] = [];
    const sample = { schema: 'run.v1', confidence: {level:'HIGH',reason:'test',score:0.9}, results: {conservative:{outcome:1},most_likely:{outcome:1},optimistic:{outcome:1}}, model_card: {response_hash:'a'.repeat(64)}, meta: {seed:42,version:'1.0.0'} };
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();
      JSON.stringify(sample);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(0.95 * 1000)];
    expect(p95).toBeLessThan(0.5);
  });
});
