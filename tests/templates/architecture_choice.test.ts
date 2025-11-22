import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('Template: architecture_choice', () => {
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    process.env.SCM_LITE_ENABLE = '0';
    process.env.RATE_LIMIT_RPM = '0';

    const { createServer } = await import('../../src/createServer.js');
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

  it('Test 1: Shape & v1.2 fields', async () => {
    const res = await fetch(`${baseUrl}/v1/templates/architecture_choice/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.version).toBe('1.2');
    expect(data.default_seed).toBeGreaterThan(0);
    expect(data.nodes).toBeInstanceOf(Array);
    expect(data.edges).toBeInstanceOf(Array);

    const hasBeliefEdge = data.edges.some((e: any) =>
      typeof e.belief === 'number' && e.belief >= 0 && e.belief <= 1 && e.provenance === 'template'
    );
    expect(hasBeliefEdge).toBe(true);

    const hasLegacy = data.edges.some((e: any) => 'confidence' in e || 'probability' in e);
    expect(hasLegacy).toBe(false);
  });

  it('Test 2: Determinism', async () => {
    const graphRes = await fetch(`${baseUrl}/v1/templates/architecture_choice/graph`);
    const graph = await graphRes.json();

    const payload = { graph, seed: 4242 };

    const res1 = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.model_card?.response_hash).toBeDefined();

    const res2 = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();

    expect(data2.model_card.response_hash).toBe(data1.model_card.response_hash);
  });

  it('Test 3: Connectivity & Validation', async () => {
    const graphRes = await fetch(`${baseUrl}/v1/templates/architecture_choice/graph`);
    const graph = await graphRes.json();

    const decisionNodes = graph.nodes.filter((n: any) => n.kind === 'decision');
    expect(decisionNodes.length).toBeGreaterThanOrEqual(1);

    for (const decision of decisionNodes) {
      const outgoing = graph.edges.filter((e: any) => e.from === decision.id);
      expect(outgoing.length).toBeGreaterThan(0);
    }

    const valRes = await fetch(`${baseUrl}/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph })
    });
    expect(valRes.status).toBe(200);
    const valData = await valRes.json();
    expect(valData.valid).toBe(true);
  });

  it('Test 4: Plausibility', async () => {
    const res = await fetch(`${baseUrl}/v1/templates/architecture_choice/graph`);
    const data = await res.json();

    const hasMaxBelief = data.edges.some((e: any) => e.belief === 1.0);
    expect(hasMaxBelief).toBe(false);

    for (const edge of data.edges) {
      expect(edge.weight).toBeGreaterThan(-1);
      expect(edge.weight).toBeLessThan(1);
    }

    const hasNegative = data.edges.some((e: any) => e.weight < 0);
    expect(hasNegative).toBe(true);
  });
});
