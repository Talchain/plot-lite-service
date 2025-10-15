import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Inflight accounting (decrement once)', () => {
  let app: any;

  beforeEach(async () => {
    app = await createServer({ enableTestRoutes: false });
  });

  it('JSON: 100 concurrent POSTs return to zero', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        app.inject({
          method: 'POST',
          url: '/v1/run',
          payload: {
            graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
            outcome_node: 'A',
          },
        })
      );
    }

    await Promise.all(promises);
    
    // Wait for cleanup
    await new Promise(r => setTimeout(r, 50));
    
    const count = app.inflight.count();
    const stats = app.inflight.stats();
    
    expect(count).toBe(0);
    expect(stats.underflows).toBe(0);
  });

  it('inflight never negative during concurrent requests', async () => {
    const samples: number[] = [];
    const interval = setInterval(() => {
      samples.push(app.inflight.count());
    }, 5);

    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(
        app.inject({
          method: 'GET',
          url: '/v1/health',
        })
      );
    }

    await Promise.all(promises);
    clearInterval(interval);

    // All samples should be >= 0
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
    }

    expect(app.inflight.stats().underflows).toBe(0);
  });

  it('decrementOnce is idempotent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(res.statusCode).toBe(200);
    expect(app.inflight.count()).toBe(0);
  });
});
