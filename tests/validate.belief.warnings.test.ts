import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('Validation warnings', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => { await app.close(); });

  it('warns on missing belief for outcome edge (non-fatal)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A', kind: 'option' },
            { id: 'B', label: 'B', kind: 'outcome' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        }
      })
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.valid).toBe(true); // warnings are non-fatal
    expect(data.violations.some((v: any) => v.code === 'MISSING_BELIEF_ON_OUTCOME_EDGE')).toBe(true);
    expect(data.violations.some((v: any) => v.code === 'OPTION_NO_OUTGOING')).toBe(true);
  });
});
