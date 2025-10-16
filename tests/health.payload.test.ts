import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('GET /v1/health observability fields', () => {
  let app: any;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes required fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    
    expect(typeof data.last_compute_ms).toBe('number');
    expect(typeof data.engine_p95_ms).toBe('number');
    expect(typeof data.json_429_count).toBe('number');
    expect(typeof data.sse_429_count).toBe('number');
    expect(typeof data.idem_cache_size).toBe('number');
    expect(data.status).toBe('ok');
  });
});
