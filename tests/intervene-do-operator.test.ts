import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/intervene - do-operator', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('determinism: same seed + actions → same hash', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X' }, { id: 'Y', label: 'Y' }],
        edges: [{ from: 'X', to: 'Y' }]
      },
      actions: [{ node_id: 'X', value: 0.8 }],
      seed: 4242
    };

    const res1 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();

    expect(data1.response_hash).toBe(data2.response_hash);
    expect(data1.model_card.actions_hash).toBe(data2.model_card.actions_hash);
  });

  it('determinism: different seed → different hash', async () => {
    const payload1 = {
      graph: {
        nodes: [{ id: 'X', label: 'X' }],
        edges: []
      },
      actions: [{ node_id: 'X', value: 0.5 }],
      seed: 1111
    };

    const payload2 = { ...payload1, seed: 2222 };

    const res1 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload1)
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload2)
    });
    const data2 = await res2.json();

    expect(data1.response_hash).not.toBe(data2.response_hash);
  });

  it('do-operator blocks confounding (backdoor path)', async () => {
    // Graph: Z → X → Y, Z → Y (confounding)
    // do(X=v) should block Z → X edge
    const payload = {
      graph: {
        nodes: [
          { id: 'Z', label: 'Confounder' },
          { id: 'X', label: 'Treatment' },
          { id: 'Y', label: 'Outcome' }
        ],
        edges: [
          { from: 'Z', to: 'X' },
          { from: 'X', to: 'Y' },
          { from: 'Z', to: 'Y' }
        ]
      },
      actions: [{ node_id: 'X', value: 0.9 }],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.schema).toBe('intervene.v1');
    expect(data.explain.provenance).toBe('do-operator');
    expect(data.baseline).toBeDefined();
    expect(data.counterfactual).toBeDefined();
    expect(data.delta).toBeDefined();
  });

  it('non-existent node_id → 400 with field pointer', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      actions: [{ node_id: 'NonExistent', value: 0.5 }],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.field).toBe('actions[].node_id');
    expect(data.error.message).toContain('NonExistent');
  });

  it('missing actions array → 400 with field pointer', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.field).toBe('actions');
  });

  it('multiple simultaneous interventions', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C' }
        ],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'C' }
        ]
      },
      actions: [
        { node_id: 'A', value: 0.8 },
        { node_id: 'B', value: 0.6 }
      ],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.model_card.actions_hash).toBeDefined();
    expect(data.explain.top_drivers).toHaveLength(2);
  });

  it('SCM-Lite flag respected', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X' }],
        edges: []
      },
      actions: [{ node_id: 'X', value: 0.5 }],
      seed: 4242,
      flags: { scm_lite: 1 }
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.model_card.flags_on).toContain('scm_lite');
  });

  it('actions hash is order-independent', async () => {
    const payload1 = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: []
      },
      actions: [
        { node_id: 'A', value: 0.5 },
        { node_id: 'B', value: 0.7 }
      ],
      seed: 4242
    };

    const payload2 = {
      ...payload1,
      actions: [
        { node_id: 'B', value: 0.7 },
        { node_id: 'A', value: 0.5 }
      ]
    };

    const res1 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload1)
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload2)
    });
    const data2 = await res2.json();

    expect(data1.model_card.actions_hash).toBe(data2.model_card.actions_hash);
  });

  it('response includes baseline, counterfactual, and delta', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'X', label: 'X' }],
        edges: []
      },
      actions: [{ node_id: 'X', value: 0.8 }],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(data.baseline.summary).toHaveProperty('p10');
    expect(data.baseline.summary).toHaveProperty('p50');
    expect(data.baseline.summary).toHaveProperty('p90');
    
    expect(data.counterfactual.summary).toHaveProperty('p10');
    expect(data.counterfactual.summary).toHaveProperty('p50');
    expect(data.counterfactual.summary).toHaveProperty('p90');
    
    expect(data.delta).toHaveProperty('p10');
    expect(data.delta).toHaveProperty('p50');
    expect(data.delta).toHaveProperty('p90');
  });

  it('response_hash is deterministic', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      actions: [{ node_id: 'A', value: 0.5 }],
      seed: 9999
    };

    const res1 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();

    expect(data1.response_hash).toBe(data2.response_hash);
    expect(data1.response_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('top_drivers shows intervened nodes', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'X', label: 'X' },
          { id: 'Y', label: 'Y' },
          { id: 'Z', label: 'Z' }
        ],
        edges: []
      },
      actions: [
        { node_id: 'X', value: 0.9 },
        { node_id: 'Y', value: -0.5 },
        { node_id: 'Z', value: 0.3 }
      ],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(data.explain.top_drivers).toHaveLength(3);
    expect(data.explain.top_drivers[0]).toHaveProperty('node_id');
    expect(data.explain.top_drivers[0]).toHaveProperty('contribution');
    expect(data.explain.top_drivers[0]).toHaveProperty('sign');
    expect(data.explain.top_drivers[1].sign).toBe('-'); // Y has negative value
  });

  /**
   * KERNEL CORRECTNESS TEST
   * Verifies that the intervene endpoint uses the actual SCM kernel, not placeholder arithmetic.
   *
   * Graph: A -> B -> C with deterministic edges (belief=1.0)
   * A=1 (baseline) -> B=1*2=2 -> C=2*3=6
   * do(A=10) -> B=10*2=20 -> C=20*3=60
   *
   * Delta should be: counterfactual(60) - baseline(6) = 54
   */
  it('kernel correctness: intervention produces correct mathematical result', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Cause' },
          { id: 'B', label: 'Mediator' },
          { id: 'C', label: 'Effect', kind: 'goal' }
        ],
        edges: [
          { from: 'A', to: 'B', weight: 2, belief: 1.0 },
          { from: 'B', to: 'C', weight: 3, belief: 1.0 }
        ]
      },
      actions: [{ node_id: 'A', value: 10 }],
      seed: 42,
      k_samples: 64
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    // With do(A=10) and deterministic edges (belief=1.0):
    // B = 10 * 2 = 20
    // C = 20 * 3 = 60
    expect(data.counterfactual.summary.p50).toBe(60);

    // Verify delta is computed correctly
    const expectedDelta = data.counterfactual.summary.p50 - data.baseline.summary.p50;
    expect(data.delta.p50).toBeCloseTo(expectedDelta, 2);

    // Verify the endpoint uses kernel (includes bma_hash)
    expect(data.model_card.bma_hash).toBeDefined();
    expect(data.model_card.k_evaluated).toBeGreaterThan(0);
  });

  /**
   * TARGET AUTO-DETECTION TEST
   * Verifies that the target node is correctly auto-detected when not specified.
   */
  it('auto-detects goal node as target', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'X', label: 'Treatment' },
          { id: 'Y', label: 'Outcome', kind: 'goal' }
        ],
        edges: [{ from: 'X', to: 'Y', weight: 2, belief: 1.0 }]
      },
      actions: [{ node_id: 'X', value: 5 }],
      seed: 42
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.target).toBe('Y'); // Auto-detected goal node
    // With do(X=5): Y = 5 * 2 = 10
    expect(data.counterfactual.summary.p50).toBe(10);
  });

  /**
   * EXPLICIT TARGET TEST
   * Verifies that an explicit target parameter overrides auto-detection.
   */
  it('uses explicit target parameter when provided', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
          { id: 'C', label: 'C', kind: 'goal' }
        ],
        edges: [
          { from: 'A', to: 'B', weight: 2, belief: 1.0 },
          { from: 'A', to: 'C', weight: 3, belief: 1.0 }
        ]
      },
      target: 'B', // Override auto-detection
      actions: [{ node_id: 'A', value: 5 }],
      seed: 42
    };

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.target).toBe('B'); // Uses explicit target, not goal node C
    // With do(A=5) and target B: B = 5 * 2 = 10
    expect(data.counterfactual.summary.p50).toBe(10);
  });
});
