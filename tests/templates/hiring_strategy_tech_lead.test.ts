import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Template: hiring_strategy_tech_lead', () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
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
    const res = await fetch(`${baseUrl}/v1/templates/hiring_strategy_tech_lead/graph`);
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.version).toBe('1.2');
    expect(data.default_seed).toBeGreaterThan(0);
    expect(data.nodes).toBeInstanceOf(Array);
    expect(data.edges).toBeInstanceOf(Array);
    
    // At least one edge has belief and provenance
    const hasBeliefEdge = data.edges.some((e: any) => 
      typeof e.belief === 'number' && e.belief >= 0 && e.belief <= 1 && e.provenance === 'template'
    );
    expect(hasBeliefEdge).toBe(true);
    
    // No legacy confidence/probability
    const hasLegacy = data.edges.some((e: any) => 'confidence' in e || 'probability' in e);
    expect(hasLegacy).toBe(false);
  });

  it('Test 2: Determinism', async () => {
    const graphRes = await fetch(`${baseUrl}/v1/templates/hiring_strategy_tech_lead/graph`);
    const graph = await graphRes.json();
    
    const runPayload = { graph, seed: 4242 };
    
    // First run
    const res1 = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runPayload)
    });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.model_card?.response_hash).toBeDefined();
    
    // Second run
    const res2 = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runPayload)
    });
    const data2 = await res2.json();
    
    // Hashes must match
    expect(data2.model_card.response_hash).toBe(data1.model_card.response_hash);
  });

  it('Test 3: Connectivity & Validation', async () => {
    const graphRes = await fetch(`${baseUrl}/v1/templates/hiring_strategy_tech_lead/graph`);
    const graph = await graphRes.json();
    
    // Check decision has outgoing edges
    const decisionNodes = graph.nodes.filter((n: any) => n.kind === 'decision');
    expect(decisionNodes.length).toBeGreaterThanOrEqual(1);
    
    for (const decision of decisionNodes) {
      const outgoing = graph.edges.filter((e: any) => e.from === decision.id);
      expect(outgoing.length).toBeGreaterThan(0);
    }
    
    // Check each option reaches at least one outcome
    const optionNodes = graph.nodes.filter((n: any) => n.kind === 'option');
    const outcomeNodes = graph.nodes.filter((n: any) => n.kind === 'outcome');
    
    for (const option of optionNodes) {
      const reachable = new Set<string>();
      const queue = [option.id];
      const visited = new Set<string>();
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        
        const outEdges = graph.edges.filter((e: any) => e.from === current);
        for (const edge of outEdges) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
      
      const reachesOutcome = outcomeNodes.some((o: any) => reachable.has(o.id));
      expect(reachesOutcome).toBe(true);
    }
    
    // Validate endpoint
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
    const res = await fetch(`${baseUrl}/v1/templates/hiring_strategy_tech_lead/graph`);
    const data = await res.json();
    
    // No belief === 1.0
    const hasMaxBelief = data.edges.some((e: any) => e.belief === 1.0);
    expect(hasMaxBelief).toBe(false);
    
    // All weights in (-1, 1)
    for (const edge of data.edges) {
      expect(edge.weight).toBeGreaterThan(-1);
      expect(edge.weight).toBeLessThan(1);
    }
    
    // At least one negative edge
    const hasNegative = data.edges.some((e: any) => e.weight < 0);
    expect(hasNegative).toBe(true);
  });
});
