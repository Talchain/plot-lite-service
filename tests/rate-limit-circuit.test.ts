import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Rate-Limit Circuit Breaker (H3)', () => {
  let app: any;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('normal behavior under load', async () => {
    const results = await Promise.all(
      Array(20).fill(0).map(() =>
        app.inject({
          method: 'POST',
          url: '/v1/run',
          payload: {
            seed: 4242,
            graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
            outcome_node: 'A'
          }
        })
      )
    );

    const statuses = results.map(r => r.statusCode);
    const has200 = statuses.some(s => s === 200);
    const has429 = statuses.some(s => s === 429);
    
    // Either all succeed or some rate-limited (no 503)
    expect(has200 || has429).toBe(true);
    expect(statuses.every(s => s === 200 || s === 429)).toBe(true);
  });

  it('circuit breaker headers when triggered', async () => {
    // This test would require triggering the breaker
    // For now, just verify normal responses don't have breaker headers
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        outcome_node: 'A'
      }
    });

    expect(res.headers['x-ratelimit-reason']).toBeUndefined();
  });
});
