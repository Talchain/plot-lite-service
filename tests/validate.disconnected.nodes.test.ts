/**
 * Test: DECISION_NO_OUTGOING and OPTION_NO_OUTGOING warnings
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('POST /v1/validate - disconnected node warnings', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => { await app.close(); });

  it('warns when decision has no outgoing edges', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'D', label: 'Decision', kind: 'decision' },
            { id: 'O', label: 'Outcome', kind: 'outcome' }
          ],
          edges: [] // Decision has no outgoing
        }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    const warning = data.violations?.find((v: any) => v.code === 'DECISION_NO_OUTGOING');
    expect(warning).toBeDefined();
    expect(warning.severity).toBe('warning');
    expect(warning.suggestion).toBeTruthy();
    expect(warning.at.node).toBe('D');
  });
  
  it('warns when option has no outgoing edges', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'Opt', label: 'Option', kind: 'option' },
            { id: 'Out', label: 'Outcome', kind: 'outcome' }
          ],
          edges: [] // Option has no outgoing
        }
      })
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    const warning = data.violations?.find((v: any) => v.code === 'OPTION_NO_OUTGOING');
    expect(warning).toBeDefined();
    expect(warning.severity).toBe('warning');
    expect(warning.suggestion).toBeTruthy();
    expect(warning.at.node).toBe('Opt');
  });
});
