/**
 * Test: WEIGHT_MAGNITUDE_HIGH warning
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('POST /v1/validate - WEIGHT_MAGNITUDE_HIGH warning', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => { await app.close(); });

  it('warns when edge weight magnitude > 3', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A', kind: 'decision' },
            { id: 'B', label: 'B', kind: 'outcome' }
          ],
          edges: [
            { from: 'A', to: 'B', weight: 5.0 } // High magnitude
          ]
        }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    const warning = data.violations?.find((v: any) => v.code === 'WEIGHT_MAGNITUDE_HIGH');
    expect(warning).toBeDefined();
    expect(warning.severity).toBe('warning');
    expect(warning.suggestion).toBeTruthy();
    expect(warning.suggestion.length).toBeGreaterThan(0);
  });
});
