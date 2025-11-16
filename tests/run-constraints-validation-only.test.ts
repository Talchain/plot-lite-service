/**
 * Phase 2: Verify /v1/run validates constraints but does NOT apply them
 * Conservative behavior: constraints are accepted but ignored during inference
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('/v1/run - Constraints Validation Only (Conservative)', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const minimalPayload = {
    graph: {
      nodes: [
        { id: 'A', label: 'Node A', belief: 0.6 },
        { id: 'B', label: 'Node B' }
      ],
      edges: [
        { id: 'e1', from: 'A', to: 'B', weight: 0.7 }
      ]
    },
    seed: 4242
  };

  it('accepts valid constraints without applying them', async () => {
    const payload = {
      ...minimalPayload,
      constraints: {
        bounds: {
          A: { min: 0.5, max: 0.9 }
        }
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    
    // Verify response structure
    expect(body.schema).toBe('run.v1');
    expect(body.result).toBeDefined();
    expect(body.result.summary).toBeDefined();
    expect(body.model_card).toBeDefined();
    
    // Constraints are NOT reflected in meta (not applied)
    expect(body.meta.constraints_applied).toBeUndefined();
  });

  it('rejects malformed constraints (validation)', async () => {
    const payload = {
      ...minimalPayload,
      constraints: {
        bounds: {
          NONEXISTENT_NODE: { min: 0, max: 1 }
        }
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Should reject invalid node reference
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
    expect(body.error.message).toContain('NONEXISTENT_NODE');
  });

  it('validates constraints that violate current node values', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Node A', value: 0.6 }, // Use value, not belief
          { id: 'B', label: 'Node B' }
        ],
        edges: [
          { id: 'e1', from: 'A', to: 'B', weight: 0.7 }
        ]
      },
      seed: 4242,
      constraints: {
        bounds: {
          A: { min: 0.8, max: 0.9 } // Node A has value 0.6, violates min 0.8
        }
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // /v1/run validates constraints - should reject violation
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
    expect(body.error.message).toContain('violates min bound');
  });

  it('determinism unaffected by constraints presence', async () => {
    const payloadWithConstraints = {
      ...minimalPayload,
      constraints: {
        bounds: {
          A: { min: 0.5, max: 0.9 }
        }
      }
    };

    const payloadWithoutConstraints = {
      ...minimalPayload
    };

    const res1 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadWithConstraints)
    });

    const res2 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadWithoutConstraints)
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // Same seed, same graph → same response_hash (constraints ignored)
    expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    expect(body1.result.summary.p50).toBe(body2.result.summary.p50);
  });
});
