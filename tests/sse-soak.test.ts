import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('SSE Concurrency Soak (D4)', () => {
  it('SSE counters exist in health', async () => {
    const app = await createServer({ enableTestRoutes: false });
    const health = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = JSON.parse(health.body);
    
    expect(body.sse_open).toBeDefined();
    expect(body.sse_closed).toBeDefined();
    expect(body.sse_timeout).toBeDefined();
    
    await app.close();
  });

  it('parallel requests stay bounded', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const results = await Promise.all(
      Array(20).fill(0).map(() => 
        app.inject({ method: 'POST', url: '/v1/run', payload: { seed: 1, graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] }, outcome_node: 'A' } })
      )
    );
    
    expect(results.every(r => r.statusCode === 200 || r.statusCode === 429)).toBe(true);
    await app.close();
  });
});
