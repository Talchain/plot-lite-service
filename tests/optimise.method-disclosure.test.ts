import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

/**
 * Honest method disclosure (additive, #240 scale_provenance tradition): the wire must
 * not imply capabilities the route lacks. The optimiser is a greedy-independent
 * marginal-gain knapsack (assumes additive/independent action effects; NOT a joint
 * combinatorial optimiser) and actions SCALE outgoing edge weights (NOT a do-operator
 * that sets node values). Disclose both on the response.
 *
 * Fails at HEAD (fields absent) and passes once the markers are emitted.
 */
describe('POST /v1/optimise - honest method disclosure', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('discloses method and action_semantics on the response', async () => {
    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'R', label: 'R' }, { id: 'T', label: 'T' }],
          edges: [{ from: 'R', to: 'T', weight: 1, belief_exists: 1 }],
        },
        budget: 10,
        actions: [{ id: 'a1', cost: 2, do: [{ node_id: 'R', set_to: 3 }] }],
        objective: { type: 'utility_linear', weights: { T: 1.0 } },
        seed: 4242,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.method).toBe('greedy_independent_v1');
    expect(data.action_semantics).toBe('edge_weight_scaling');
  });
});
