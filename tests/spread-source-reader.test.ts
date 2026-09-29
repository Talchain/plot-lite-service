/**
 * R3-B #72 5895208669 (frames, AIQ 5895140735; DL 5895185190: R3-B owns the downstream PLoT/ISL reader of the
 * spread-source marker). Upstream `observed_state.std_source` says whose spread `std` is; PLoT maps it onto ISL's
 * existing `ParameterUncertainty.spread_source` ('user' | 'template') for a REAL std only, and never forwards it on
 * ISL's ObservedState. Absent / unknown → no key (ISL echoes null, "not stated") — a spread is never called the
 * user's unless upstream says so. Route rows run on the served request fixture (paul-own-a295e4a1).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildParameterUncertaintiesV3, spreadSourceOf } from '../src/integrations/isl/translator-v3.js';

let islBodies: any[] = [];

function optionResults(options: any[]) {
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: { mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    rank: idx + 1,
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [], explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(): Promise<never> { throw new Error('not called'); },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islBodies.push(body);
    return {
      data: {
        options: optionResults(body.options || []), edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8, fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

const FIXTURE = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json');
const REQUEST = JSON.parse(readFileSync(FIXTURE, 'utf8'));

const factor = (id: string, observed_state: Record<string, unknown>): any => ({ id, kind: 'factor', label: id, observed_state });
const puFor = (pus: any[] | undefined, id: string) => (pus ?? []).find((p: any) => p.node_id === id);

describe('spreadSourceOf — the claim → ISL spread_source', () => {
  it("'user' → 'user'; 'olumi' → 'template'", () => {
    expect(spreadSourceOf('user')).toBe('user');
    expect(spreadSourceOf('olumi')).toBe('template');
  });
  it('absent / unknown / wrong type → undefined (fail closed, never the user\'s)', () => {
    for (const v of [undefined, null, '', 'template', 'User', 'ai', 'frame_carried', 1, {}]) expect(spreadSourceOf(v)).toBeUndefined();
  });
});

describe('buildParameterUncertaintiesV3 — spread_source on a REAL std only', () => {
  it("a real std marked 'user' carries spread_source 'user'; the std itself is unchanged", () => {
    const pu = puFor(buildParameterUncertaintiesV3([factor('a', { value: 0.5, std: 0.2, std_source: 'user' })]), 'a');
    expect(pu).toEqual({ node_id: 'a', distribution: 'normal', std: 0.2, spread_source: 'user' });
  });
  it("a real std marked 'olumi' (a frame-carried spread) carries spread_source 'template'", () => {
    const pu = puFor(buildParameterUncertaintiesV3([factor('a', { value: 0.5, std: 0.2, std_source: 'olumi' })]), 'a');
    expect(pu).toEqual({ node_id: 'a', distribution: 'normal', std: 0.2, spread_source: 'template' });
  });
  it('CONTROL — a real std with no std_source is byte-identical to before (no spread_source key)', () => {
    const pu = puFor(buildParameterUncertaintiesV3([factor('a', { value: 0.5, std: 0.2 })]), 'a');
    expect(pu).toEqual({ node_id: 'a', distribution: 'normal', std: 0.2 });
    expect('spread_source' in pu).toBe(false);
  });
  it('an unknown std_source is dropped, never mapped to user', () => {
    const pu = puFor(buildParameterUncertaintiesV3([factor('a', { value: 0.5, std: 0.2, std_source: 'frame_carried' })]), 'a');
    expect('spread_source' in pu).toBe(false);
  });
  it('a SYNTHESISED spread (no real std) is never labelled, whatever std_source says', () => {
    const pu = puFor(buildParameterUncertaintiesV3([factor('a', { value: 0.5, std_source: 'user' })]), 'a');
    expect(pu.distribution).toBe('normal');
    expect(pu.std).toBeCloseTo(0.1, 10); // max(DEFAULT_STD_FLOOR 0.1, 0.15 × 0.5 = 0.075)
    expect('spread_source' in pu).toBe(false);
  });
  it('a PINNED lever is held exact before any std — point_mass, no spread_source', () => {
    // pinnedLeverIds: a controllable factor at today 0, and an option setting it to today (held, T7b).
    const nodes = [{ ...factor('lever', { value: 0, std: 0.05, std_source: 'user' }), category: 'controllable' }];
    const options: any[] = [{ id: 'o1', interventions: { lever: { value: 0 } } }];
    const pu = puFor(buildParameterUncertaintiesV3(nodes as any, options), 'lever');
    expect(pu).toEqual({ node_id: 'lever', distribution: 'point_mass' });
  });
});

describe('route — /v2/run carries the marker from the served request to ISL, and only on ParameterUncertainty', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  async function run(payload: any) {
    islBodies = [];
    const res = await fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    return res.json();
  }

  function marked(): any {
    const d = structuredClone(REQUEST);
    const set = (id: string, patch: Record<string, unknown>) => {
      const n = d.graph.nodes.find((x: any) => x.id === id);
      n.observed_state = { ...n.observed_state, ...patch };
    };
    set('other_mrr_growth', { std: 0.05, std_source: 'olumi' });
    set('pro_paying_subscribers', { std: 0.03, std_source: 'user' });
    return d;
  }

  it('PRECONDITION — the served fixture carries no std_source anywhere, and pro_plan_price has a real std', () => {
    expect(JSON.stringify(REQUEST)).not.toContain('std_source');
    expect(REQUEST.graph.nodes.find((n: any) => n.id === 'pro_plan_price').observed_state.std).toBe(0.0001);
  });

  it("the marked factors reach ISL with spread_source 'template' / 'user'; the unmarked real std has none", async () => {
    await run(marked());
    const bodies = islBodies.filter((b) => Array.isArray(b?.parameter_uncertainties));
    expect(bodies.length, 'an ISL call must carry parameter_uncertainties').toBeGreaterThan(0);
    for (const b of bodies) {
      const pus = b.parameter_uncertainties;
      expect(puFor(pus, 'other_mrr_growth')).toMatchObject({ distribution: 'normal', std: 0.05, spread_source: 'template' });
      expect(puFor(pus, 'pro_paying_subscribers')).toMatchObject({ distribution: 'normal', std: 0.03, spread_source: 'user' });
      const price = puFor(pus, 'pro_plan_price');
      if (price) expect('spread_source' in price).toBe(false);
    }
  });

  it('std_source never reaches ISL on the node ObservedState (not an ISL-declared member)', async () => {
    await run(marked());
    expect(islBodies.length).toBeGreaterThan(0);
    for (const b of islBodies) {
      for (const n of b?.graph?.nodes ?? []) expect(n.observed_state ?? {}).not.toHaveProperty('std_source');
    }
  });

  it('CONTROL — the unmarked served request sends no spread_source at all', async () => {
    await run(structuredClone(REQUEST));
    const all = JSON.stringify(islBodies);
    expect(islBodies.length).toBeGreaterThan(0);
    expect(all).not.toContain('spread_source');
  });
});
