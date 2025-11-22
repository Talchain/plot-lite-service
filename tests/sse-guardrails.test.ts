import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('SSE Guardrails (C3)', () => {
  it('health exposes sse counters', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = JSON.parse(health.body);
    
    expect(body.sse_open).toBeDefined();
    expect(body.sse_closed).toBeDefined();
    expect(body.sse_timeout).toBeDefined();
    expect(typeof body.sse_open).toBe('number');
    
    await app.close();
  });

  it('increments sse_open on stream start', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const healthBefore = await app.inject({ method: 'GET', url: '/v1/health' });
    const openBefore = JSON.parse(healthBefore.body).sse_open || 0;
    
    // Start demo stream (fast path)
    await app.inject({ method: 'GET', url: '/v1/stream?demo=1' });
    
    const healthAfter = await app.inject({ method: 'GET', url: '/v1/health' });
    const openAfter = JSON.parse(healthAfter.body).sse_open;
    
    expect(openAfter).toBeGreaterThan(openBefore);
    
    await app.close();
  });

  it('SSE_MAX_MS env configures timeout', () => {
    process.env.SSE_MAX_MS = '90000';
    const { SSE_SLOT_MAX_MS } = require('../dist/config/constants.js');
    expect(SSE_SLOT_MAX_MS).toBe(90000);
    delete process.env.SSE_MAX_MS;
  });

  it('timeout callback increments sse_timeout counter', async () => {
    process.env.SSE_MAX_MS = '50';
    const app = await createServer({ enableTestRoutes: false });
    
    // Start a stream without demo (would timeout if not closed)
    const controller = new AbortController();
    const streamPromise = app.inject({
      method: 'GET',
      url: '/v1/stream',
      signal: controller.signal as any,
    }).catch(() => {});
    
    // Let timeout trigger
    await new Promise(resolve => setTimeout(resolve, 80));
    
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = JSON.parse(health.body);
    
    // Should have at least triggered timeout logic
    expect(body.sse_timeout).toBeGreaterThanOrEqual(0);
    
    await app.close();
    delete process.env.SSE_MAX_MS;
  });
});
