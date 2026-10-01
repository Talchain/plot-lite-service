/**
 * ⭐ M2 cause (DL 5934513210 condition 2): a NORMAL `/v2/run` emits `_meta.evidence.isl_draw_structure_key`, with no
 * flag. Real `createServer`, real `ISLClient`, stubbed transport (the ISL SERVICE is not mocked: mocking it bypasses the
 * client that records the key, and every row below would be vacuous). Harness after `downstream-tracker-keying.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import { __setIslComputeAdmissionForTest } from '../src/integrations/isl/compute-admission.js';
import { islDrawStructureKey } from '../src/lib/isl-draw-structure-key.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ISL_HOST = 'https://isl-dsk.test.local';
type Mut = Record<string, any>;

const body = (edit: (b: Mut) => void = () => {}): Mut => {
  const b: Mut = {
    graph: {
      nodes: [
        { id: 'fac_cost', kind: 'factor', label: 'Cost', observed_state: { value: 0.86, baseline: 0.86, unit: 'GBP', raw_value: 275000, cap: 320000 } },
        { id: 'fac_demand', kind: 'factor', label: 'Demand', observed_state: { value: 0.4, baseline: 0.4, unit: 'GBP', raw_value: 40, cap: 100 } },
        { id: 'outcome', kind: 'goal', label: 'Net Position' },
      ],
      edges: [
        { from: 'fac_cost', to: 'outcome', exists_probability: 0.95, strength: { mean: -0.7, std: 0.1 } },
        { from: 'fac_demand', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
      ],
    },
    options: [
      { id: 'opt_a', label: 'A', interventions: { fac_demand: { value: 0.2, source: 'user_specified' } } },
      { id: 'opt_b', label: 'B', interventions: { fac_demand: { value: 0.8, source: 'user_specified' } } },
    ],
    goal_node_id: 'outcome',
    seed: '42',
  };
  edit(b);
  return b;
};

let islBodies: Mut[] = [];
/** Answers for the next `/robustness/analyze` attempts, consumed in order; then the computed envelope (200). */
let robustnessQueue: Array<{ status: number; body: unknown }> = [];
function seedAdmission(): void {
  __setIslComputeAdmissionForTest({
    status: 'ok', skew: false,
    admission: {
      max_cost_units: 24_000_000, complexity_formula_version: 'v2-weighted-2026-07',
      weights: { base_per_sample_per_option_per_struct: 1, evpi_sample_cap: 2000, sensitivity_coef: 4, evalue_coef: 20, bands_coef: 200, path_coef: 1, max_decomposition_paths: 20000 },
      caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 50 },
    },
  } as never);
}

describe('/v2/run emits the ISL draw-structure key on every Run (no flag)', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = ISL_HOST;
    process.env.ISL_API_KEY = 'test-dsk-key';
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    delete process.env.UI_CANONICAL_META;
    globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
      if (String(url).includes('isl-dsk.test.local')) {
        let parsed: Mut = {};
        try { parsed = JSON.parse(init?.body ?? '{}'); } catch { /* ignore */ }
        if (String(url).includes('/robustness/analyze')) {
          islBodies.push(parsed);
          const queued = robustnessQueue.shift();
          if (queued !== undefined) {
            return new Response(JSON.stringify(queued.body), { status: queued.status, headers: { 'content-type': 'application/json' } });
          }
        }
        const envelope = {
          options: ((parsed.options as Mut[] | undefined) ?? []).map((opt, idx) => ({
            option_id: opt.option_id ?? opt.id, label: 'x', win_probability: idx === 0 ? 0.72 : 0.28,
            outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
            rank: idx + 1,
          })),
          edges: [], factor_sensitivity: [], conditional_winners: [], overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
        };
        return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'isl-echo' } });
      }
      return (originalFetch as typeof fetch)(url as string, init as RequestInit);
    }) as unknown as typeof fetch;
    app = await createServer();
    await app.ready();
    seedAdmission();
  }, 60_000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    for (const k of ['ISL_ENABLE', 'ISL_BASE_URL', 'ISL_API_KEY', 'RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLED']) delete process.env[k];
  });
  beforeEach(() => { islBodies = []; robustnessQueue = []; seedAdmission(); });

  async function keyOf(payload: Mut): Promise<{ key: unknown; sent: Mut | undefined; meta: Mut }> {
    const res = await app.inject({ method: 'POST', url: '/v2/run', headers: { 'content-type': 'application/json' }, payload });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body) as Mut;
    return { key: json._meta?.evidence?.isl_draw_structure_key, sent: islBodies[0], meta: json._meta ?? {} };
  }

  it('RED: a normal Run (canonical meta OFF) carries the key, and it is the key of the request ISL received', async () => {
    const { key, sent, meta } = await keyOf(body());
    expect(meta.payloads, 'precondition: the gated payloads are absent').toBeUndefined();
    expect(sent, 'precondition: ISL was called').toBeDefined();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(islDrawStructureKey(sent));
  });

  it('a strength-mean edit keeps the key; adding a link changes it', async () => {
    const base = (await keyOf(body())).key;
    const meanEdit = (await keyOf(body((b) => { b.graph.edges[0].strength.mean = -0.5; }))).key;
    const addLink = (await keyOf(body((b) => { b.graph.edges.push({ from: 'fac_cost', to: 'fac_demand', exists_probability: 1, strength: { mean: 0.2, std: 0.1 } }); }))).key;
    expect(meanEdit).toBe(base);
    expect(addLink).not.toBe(base);
  });
  // ⛔ PLoT #430 overflow P2 (5935944093): the evidence was bound to the FIRST attempt (`primaryIslCall`), so a retry
  // that succeeded emitted `null` (the failed attempt records no key). It is now the key of the exchange whose
  // response IS the analysed result.
  it('RED (P2): 503 then 200 on a retry — the key is the successful exchange\'s, never null', async () => {
    robustnessQueue = [{ status: 503, body: { error: 'service_unavailable' } }];
    const { key } = await keyOf(body());
    expect(islBodies.length, 'precondition: ISL was asked twice (the 503, then the retry)').toBeGreaterThanOrEqual(2);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(islDrawStructureKey(islBodies[1]));
  });

  it('RED (P2): 422 identity withdrawal then 200 — the key is the RE-ASKED request\'s (the identity withdrawn), not the first', async () => {
    const a15 = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/r3-intermediate-carrier-dl-a15.request.json'), 'utf8')) as Mut;
    const parts = ['pro_plan_mrr', 'pro_plan_monthly_price', 'pro_paying_subscribers'];
    robustnessQueue = [{ status: 422, body: { critiques: [{
      id: 'crit-a15-inconsistent', code: 'IDENTITY_NOT_EVALUATED', severity: 'blocker', source: 'validation',
      message: 'pro_plan_mrr cannot be computed exactly (identity_inconsistent)', affected_node_ids: parts,
      identity: { node_id: 'pro_plan_mrr', operation: 'product', participants: parts.slice(1), withheld_reason: 'identity_inconsistent',
        reconstructed: 50000, stated: 75000, mismatch_share: 0.3333 },
    }] } }];
    const { key, meta } = await keyOf(a15);
    expect(islBodies.length, 'precondition: asked, refused (422), asked again once').toBeGreaterThanOrEqual(2);
    expect((meta.identities_not_forwarded as Mut[] | undefined)?.map((w) => w.node_id), 'precondition: the withdrawal ran').toEqual(['pro_plan_mrr']);
    expect(islDrawStructureKey(islBodies[1]), 'precondition: withdrawing the identity changes the draw structure').not.toBe(islDrawStructureKey(islBodies[0]));
    expect(key).toBe(islDrawStructureKey(islBodies[1]));
  });

  it('CONTROL: no successful exchange (a 422 nothing can withdraw) — no key rides the failure envelope', async () => {
    robustnessQueue = [{ status: 422, body: { critiques: [{ code: 'GRAPH_INVALID', severity: 'blocker', message: 'x' }] } }];
    const res = await app.inject({ method: 'POST', url: '/v2/run', headers: { 'content-type': 'application/json' }, payload: body() });
    const json = JSON.parse(res.body) as Mut;
    expect(islBodies, 'precondition: ISL was asked once, and refused').toHaveLength(1);
    expect(json._meta?.evidence?.isl_draw_structure_key ?? null).toBeNull();
  });
});
