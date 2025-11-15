import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Validator isolation', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const baseGraph = {
    nodes: [
      { id: 'A', label: 'A' },
      { id: 'B', label: 'B' }
    ],
    edges: [{ from: 'A', to: 'B', weight: 0.5 }]
  };

  it('run endpoint accepts priors without affecting other routes', async () => {
    // /v1/run should accept priors
    const runRes = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: baseGraph,
        seed: 4242,
        priors: { A: 0.6 }
      })
    });

    expect(runRes.status).toBe(200);
    const runData = await runRes.json();
    expect(runData.schema).toBe('run.v1');
  });

  it('counterfactual endpoint rejects priors (different schema)', async () => {
    // /v1/counterfactual should NOT accept priors (different route, different schema)
    const cfRes = await fetch(`${server.baseUrl}/v1/counterfactual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: baseGraph,
        intervention: { node_id: 'A', value: 1.0 },
        outcome_node: 'B',
        seed: 4242,
        priors: { A: 0.6 }  // Should be rejected
      })
    });

    expect(cfRes.status).toBe(400);
    const cfData = await cfRes.json();
    expect(cfData.code).toBe('BAD_INPUT');
    expect(cfData.message).toContain('priors');
  });

  it('run endpoint accepts evidence without affecting other routes', async () => {
    // /v1/run should accept evidence
    const runRes = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: baseGraph,
        seed: 4242,
        evidence: [{ node_id: 'A', source: 'test' }]
      })
    });

    expect(runRes.status).toBe(200);
    const runData = await runRes.json();
    expect(runData.schema).toBe('run.v1');
  });

  it('validators do not leak between sequential requests', async () => {
    // Multiple requests to /v1/run with different priors should all succeed
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: baseGraph,
          seed: 4242 + i,
          priors: { A: 0.5 + i * 0.1 }
        })
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run.v1');
    }
  });
});
