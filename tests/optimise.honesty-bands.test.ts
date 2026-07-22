import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

/**
 * R2: utility.p10/p50/p90 were SYNTHETIC (expected*0.9 / ==expected / expected*1.1),
 * fabricated bands presented as computed uncertainty. The reported `expected` is a
 * greedy-additive composition of per-action median deltas, so no single MC distribution
 * backs it and no honest band exists. Fix = OMIT the bands; keep only `expected`.
 *
 * These tests fail at HEAD (4 keys incl. fabricated bands) and pass after the omit.
 */
describe('POST /v1/optimise - R2 no fabricated uncertainty bands', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('reports only the computed expected, with no fabricated p10/p50/p90', async () => {
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

    // Positive control: the response DOES carry a computed point estimate...
    expect(data.utility).toBeDefined();
    expect(typeof data.utility.expected).toBe('number');
    expect(data.utility.expected).not.toBe(0);

    // ...and carries NOTHING ELSE. At HEAD utility has 4 keys incl. the synthetic
    // bands, so this equality FAILS at HEAD (proves the test can see the presence).
    // The tell-tale fabrication was p10 === expected*0.9 && p90 === expected*1.1; a
    // utility with only the `expected` key cannot exhibit that ±10% spread relationship,
    // so this single keys-equality subsumes any per-band absence assertion.
    expect(Object.keys(data.utility).sort()).toEqual(['expected']);
  });
});
