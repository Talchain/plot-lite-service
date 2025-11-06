import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('/v1/run shape when SCM-Lite disabled', () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env.SCM_LITE_ENABLE = '0';
    process.env.RATE_LIMIT_RPM = '0';
    const { createServer } = await import('../src/createServer.js');
    server = await createServer({ enableTestRoutes: true });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const addr = server.server.address();
    if (addr && typeof addr === 'object') {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    await server?.close();
  });

  it('returns full run.v1 payload with all required fields', async () => {
    const graph = {
      nodes: [{ id: 'A', label: 'A', kind: 'option' }, { id: 'B', label: 'B', kind: 'outcome' }],
      edges: [{ from: 'A', to: 'B', weight: 0.5 }]
    };

    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph, seed: 4242 })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.schema).toBe('run.v1');
    expect(data.model_card).toBeDefined();
    expect(data.model_card.response_hash).toBeDefined();
    expect(data.result).toBeDefined();
    expect(data.meta).toBeDefined();
    expect(data.meta.seed).toBe(4242);
  });
});
