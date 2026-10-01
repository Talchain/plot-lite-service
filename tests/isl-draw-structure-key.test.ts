/**
 * ⭐ M2 cause (DL 5934513210 option (b); CEE #2410): PLoT owns the DRAW STRUCTURE of the ISL request it sent.
 *
 * CEE may say a rerun's movement was caused by the user's edit (`C1_attributable`) only when both Runs drew their samples
 * the same way, and it may only COMPARE two of these digests, never recompute them. So PLoT emits
 * `_meta.evidence.isl_draw_structure_key` ALWAYS (unlike `_meta.payloads`, gated by `UI_CANONICAL_META`), computed on the
 * exact body the ISL client sends.
 *
 * The structural cases are CEE #2410's rows (R3 #75 5920859011; SCIENCE/DSK 5934059958), moved here with the authority.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { islDrawStructureKey } from '../src/lib/isl-draw-structure-key.js';
import { initDownstreamTracking, getDownstreamCallsForLog, clearDownstreamTracking } from '../src/util/downstream-tracker.js';
import { ISLClient } from '../src/integrations/isl/client.js';

type Mut = Record<string, any>;
/** A served-shape ISL robustness request, with one edit applied. */
const isl = (edit: (r: Mut) => void = () => {}): Mut => {
  const r: Mut = {
    seed: '777', n_samples: 10_000, analysis_types: ['comparison', 'sensitivity', 'robustness'], include_voi: true, include_e_values: true,
    graph: {
      nodes: [
        { id: 'fac_price', kind: 'factor', epsilon_std: 0 }, { id: 'fac_churn', kind: 'factor', epsilon_std: 0 },
        { id: 'fac_ads', kind: 'factor', epsilon_std: 0 }, { id: 'goal_mrr', kind: 'goal', epsilon_std: 0 },
      ],
      edges: [
        { from: 'fac_price', to: 'fac_churn', exists_probability: 0.8, strength: { mean: 0.4, std: 0.1 } },
        { from: 'fac_churn', to: 'goal_mrr', exists_probability: 1, strength: { mean: -0.6, std: 0.1 } },
      ],
    },
    options: [{ id: 'opt-a', interventions: { fac_price: 0.59 } }, { id: 'opt-b', interventions: { fac_price: 0.49 } }],
    parameter_uncertainties: [{ node_id: 'fac_churn', distribution: 'normal', std: 0.01 }],
  };
  edit(r);
  return r;
};
const K = islDrawStructureKey;

describe('islDrawStructureKey: what changes how ISL draws, and what does not', () => {
  it('is an opaque 64-hex digest; null for a body with no graph', () => {
    expect(K(isl())).toMatch(/^[0-9a-f]{64}$/);
    expect(K({ seed: '1' })).toBeNull();
    expect(K({ graph: {} })).toBeNull();
  });

  it('SAME structure: a strength mean or std off 0, an intervention level, the seed, a prior\'s bounds', () => {
    const base = K(isl());
    expect(K(isl((r) => { r.graph.edges[0].strength.mean = 0.6; r.graph.edges[0].strength.std = 0.3; }))).toBe(base);
    expect(K(isl((r) => { r.options[0].interventions.fac_price = 0.62; }))).toBe(base);
    expect(K(isl((r) => { r.seed = '999'; }))).toBe(base);
    expect(K(isl((r) => { r.parameter_uncertainties[0].std = 0.05; }))).toBe(base);
  });

  it('CHANGED structure: add a link, an exists_probability edit, a mean to 0, a distribution change, a new lever', () => {
    const base = K(isl());
    expect(K(isl((r) => { r.graph.edges.push({ from: 'fac_ads', to: 'goal_mrr', exists_probability: 1, strength: { mean: 0.2, std: 0.1 } }); }))).not.toBe(base);
    expect(K(isl((r) => { r.graph.edges[0].exists_probability = 0.9; }))).not.toBe(base);
    expect(K(isl((r) => { r.graph.edges[0].strength.mean = 0; }))).not.toBe(base);
    expect(K(isl((r) => { r.parameter_uncertainties[0].distribution = 'point_mass'; }))).not.toBe(base);
    expect(K(isl((r) => { r.options[0].interventions.fac_ads = 0.1; }))).not.toBe(base);
    expect(K(isl((r) => { r.graph.nodes[1].epsilon_std = 0.05; }))).not.toBe(base);
    // CEE #2410 CR 5921519604: a prior added to a factor with no observed value (PLoT adds a uniform draw) is a new draw.
    expect(K(isl((r) => { r.parameter_uncertainties.push({ node_id: 'fac_ads', distribution: 'uniform', range_min: 0.02, range_max: 0.04 }); }))).not.toBe(base);
  });

  it('ORDER IS STRUCTURE: the same edges, or the same nodes, in another order (ISL draws in list order)', () => {
    const base = K(isl());
    expect(K(isl((r) => { r.graph.edges.reverse(); }))).not.toBe(base);
    expect(K(isl((r) => { r.graph.nodes.reverse(); }))).not.toBe(base);
  });
});

describe('the ISL client records the key on the EXACT body it sends', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('RED: a successful call records `draw_structure_key` = the key of the sent body — even past the debug copy\'s 30-item cap', async () => {
    const requestId = 'draw-structure-key-success';
    initDownstreamTracking(requestId);
    // 40 edges: the always-on debug copy (`sanitizePayloadForDebug`) truncates arrays at 30, so a key computed on it
    // would not see edges 31–40. The key must come from the exact body.
    const big = isl((r) => {
      for (let i = 0; i < 38; i++) r.graph.edges.push({ from: `f${i}`, to: 'goal_mrr', exists_probability: 1, strength: { mean: 0.1, std: 0.1 } });
    });
    let sent: Mut | undefined;
    globalThis.fetch = vi.fn(async (_url: unknown, init: { body?: string }) => {
      sent = JSON.parse(String(init?.body));
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{"options":[]}' };
    }) as unknown as typeof fetch;
    const client = new ISLClient({ baseUrl: 'https://isl.test.example.com', apiKey: 'test-key', timeoutMs: 5000, maxRetries: 1 });
    await client.request({ endpoint: '/api/v1/robustness/analyze/v2', body: big, requestId });
    const calls = getDownstreamCallsForLog(requestId);
    clearDownstreamTracking(requestId);
    expect(calls).toHaveLength(1);
    expect(sent).toBeDefined();
    expect(calls[0]!.draw_structure_key).toBe(K(sent));
    // Control: the last edge IS in the key (a 40th edge's probability moves it).
    const moved = structuredClone(big);
    moved.graph.edges[39].exists_probability = 0.5;
    expect(K(moved)).not.toBe(calls[0]!.draw_structure_key);
  });
});
