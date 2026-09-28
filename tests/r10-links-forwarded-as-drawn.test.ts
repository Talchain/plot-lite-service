/**
 * R10 — THE ENGINE COMPUTES THE MODEL THE USER DREW (AI Quality meaning ruling,
 * #72 5872082179; DL adopted 5872114259; step-1 measurement R&C 5872171875).
 *
 * outcome→outcome, outcome→risk and risk→outcome are LEGAL causal links (mediation,
 * and a risk's impact). ISL's propagation is kind-agnostic. PLoT used to "reroute"
 * them before computing: delete the drawn link and invent factor→target links at
 * 0.5 × the deleted link's mean. That computed a model the user never drew:
 *   · a negative first link REVERSED the path's sign (the new mean ignored a→o1);
 *   · when a→target already existed the drawn link was deleted with NO replacement
 *     and NO repair entry (both risk deletions on Paul's 657e63ef);
 *   · an identity whose operand is an outcome lost that operand's link.
 * Measured on Paul's production scenario: Current 48.3% / AI 36.4% as computed,
 * 53.3% / 32.4% as drawn. On the samples-42 corpus, 11/42 graphs were rewired.
 *
 * THE RULE PINNED HERE: every causal link reaches the engine graph exactly as
 * drawn (same endpoints, same mean, std and existence probability), nothing is
 * invented, and no reroute/unresolvable repair is recorded, because nothing was
 * repaired. Bound by identity: each link is located by its from/to ids.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';

const factor = (id: string) => ({ id, kind: 'factor' as const, label: id });
const outcome = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'outcome' as const, label: id, ...extra });
const risk = (id: string) => ({ id, kind: 'risk' as const, label: id });
const goal = (id: string) => ({ id, kind: 'goal' as const, label: id });
const edge = (from: string, to: string, mean: number, std = 0.2, ep = 0.9) => ({ from, to, strength: { mean, std }, exists_probability: ep });

type E = { from: string; to: string; strength: { mean: number; std: number }; exists_probability: number };
const find = (edges: E[], from: string, to: string) => edges.find((e) => e.from === from && e.to === to);
const REROUTE_CODES = /REROUTE|FORBIDDEN_EDGE/;

/** Every drawn edge is present unchanged, and the edge SET is exactly the drawn set. */
function expectForwardedAsDrawn(drawn: E[], engine: E[]) {
  for (const d of drawn) {
    const got = find(engine, d.from, d.to);
    expect(got, `${d.from}→${d.to} reaches the engine`).toBeDefined();
    expect(got!.strength.mean).toBe(d.strength.mean);
    expect(got!.strength.std).toBe(d.strength.std);
    expect(got!.exists_probability).toBe(d.exists_probability);
  }
  expect(engine.map((e) => `${e.from}->${e.to}`).sort()).toEqual(drawn.map((e) => `${e.from}->${e.to}`).sort());
}

describe('R10 — every legal link kind is forwarded as drawn (unit)', () => {
  const cases: Array<{ name: string; nodes: any[]; edges: E[] }> = [
    { name: 'outcome→outcome (mediation)', nodes: [factor('fac_a'), outcome('out_x'), outcome('out_y')], edges: [edge('fac_a', 'out_x', 0.6), edge('out_x', 'out_y', 0.4, 0.1, 0.8)] },
    { name: 'outcome→risk', nodes: [factor('fac_a'), outcome('out_x'), risk('risk_r')], edges: [edge('fac_a', 'out_x', 0.6), edge('out_x', 'risk_r', 0.5)] },
    { name: 'risk→outcome (a risk\'s impact)', nodes: [factor('fac_a'), risk('risk_r'), outcome('out_y')], edges: [edge('fac_a', 'risk_r', 0.5), edge('risk_r', 'out_y', -0.7)] },
    { name: 'outcome→outcome with no factor parent', nodes: [outcome('out_x'), outcome('out_y')], edges: [edge('out_x', 'out_y', 0.4)] },
  ];
  for (const c of cases) {
    it(`${c.name}: the engine graph holds exactly the drawn links`, () => {
      const res = normaliseGraphWithRepairs({ nodes: c.nodes, edges: JSON.parse(JSON.stringify(c.edges)) } as any);
      expectForwardedAsDrawn(c.edges, res.graph.edges as E[]);
    });
    it(`${c.name}: no reroute or "unresolvable" repair is recorded`, () => {
      const res = normaliseGraphWithRepairs({ nodes: c.nodes, edges: JSON.parse(JSON.stringify(c.edges)) } as any);
      expect(res.repairs.filter((r) => REROUTE_CODES.test(r.code)).map((r) => r.code)).toEqual([]);
    });
  }

  it('SIGN (AIQ row): a→o1 negative, o1→o2 positive — the path stays negative; no invented positive a→o2', () => {
    const drawn = [edge('fac_a', 'out_1', -0.6), edge('out_1', 'out_2', 0.4)];
    const res = normaliseGraphWithRepairs({ nodes: [factor('fac_a'), outcome('out_1'), outcome('out_2')], edges: JSON.parse(JSON.stringify(drawn)) } as any);
    const g = res.graph.edges as E[];
    expect(find(g, 'fac_a', 'out_2')).toBeUndefined();
    const a1 = find(g, 'fac_a', 'out_1')!, o12 = find(g, 'out_1', 'out_2')!;
    expect(a1.strength.mean * o12.strength.mean).toBeLessThan(0);
    expectForwardedAsDrawn(drawn, g);
  });

  it('IDENTITY (AIQ row): revenue = price × units with an OUTCOME operand keeps units→revenue', () => {
    const nodes = [
      factor('price'),
      outcome('units'),
      outcome('revenue', { nonlinear_identity: { operation: 'product', factor_ids: ['price', 'units'], stated_in_brief: true } }),
      goal('goal_profit'),
    ];
    // price→units makes `price` a factor parent of `units`, and price→revenue already exists:
    // the old reroute deleted units→revenue with no replacement, leaving the identity an operand short.
    const drawn = [edge('price', 'units', -0.5), edge('price', 'revenue', 1), edge('units', 'revenue', 1), edge('revenue', 'goal_profit', 1)];
    const res = normaliseGraphWithRepairs({ nodes, edges: JSON.parse(JSON.stringify(drawn)) } as any);
    const g = res.graph.edges as E[];
    for (const operand of ['price', 'units']) expect(find(g, operand, 'revenue'), `operand ${operand} feeds revenue`).toBeDefined();
    expectForwardedAsDrawn(drawn, g);
  });
});

// ---------------------------------------------------------------------------
// ROUTE — Paul's production scenario 657e63ef: the ISL request PLoT builds.
// ---------------------------------------------------------------------------
const captured: Array<{ endpoint: string; body: any }> = [];
const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  validateCausal: async () => ({ status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' }),
  analyseSensitivity: async () => ({ overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' }),
  analyseFactorSensitivity: async () => ({ factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const }),
  computeCounterfactual: async (): Promise<never> => { throw new Error('not called'); },
  async callAnalysisEndpoint(endpoint: string, body: unknown) {
    captured.push({ endpoint, body: JSON.parse(JSON.stringify(body)) });
    return { data: null, error: 'test: request captured' };
  },
};
vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});
import { createServer } from '../src/createServer.js';

describe('R10 ROUTE — Paul\'s 657e63ef reaches ISL as drawn (fixtures/r10-paul-657e63ef)', () => {
  let app: any;
  let islGraph: { nodes: any[]; edges: E[] };
  const body = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/r10-paul-657e63ef/cee-to-plot.request.json'), 'utf8'));
  const kind = new Map<string, string>(body.graph.nodes.map((n: any) => [n.id, n.kind]));
  const drawnCausal = body.graph.edges.filter((e: any) => !['option', 'decision'].includes(kind.get(e.from)!) && !['option', 'decision'].includes(kind.get(e.to)!));

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
    await app.inject({ method: 'POST', url: '/v2/run', headers: { 'Content-Type': 'application/json' }, payload: JSON.stringify(body) });
    const call = captured.find((c) => /robustness\/analyze\/v2/.test(c.endpoint));
    islGraph = call?.body?.graph;
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('PRECONDITION: the fixture draws the 10 causal links, 3 of them outcome→outcome / risk→outcome', () => {
    expect(drawnCausal).toHaveLength(10);
    const kinds = drawnCausal.map((e: any) => `${kind.get(e.from)}→${kind.get(e.to)}`);
    expect(kinds.filter((k: string) => k === 'outcome→outcome' || k === 'risk→outcome')).toHaveLength(3);
    expect(islGraph, 'PLoT called ISL /robustness/analyze/v2').toBeDefined();
  });

  it('ISL receives every drawn causal link, and only those', () => {
    const got = islGraph.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(got).toEqual(drawnCausal.map((e: any) => `${e.from}->${e.to}`).sort());
  });

  it('both risks keep their NEGATIVE effect on delegation quality (lost under the reroute)', () => {
    for (const r of ['ai_output_error_risk', 'assistant_coordination_overhead']) {
      const e = find(islGraph.edges, r, 'delegation_quality');
      expect(e, `${r}→delegation_quality`).toBeDefined();
      expect(e!.strength.mean).toBeLessThan(0);
    }
  });

  it('delegation quality still reaches the goal (Paul\'s approved link can affect the result)', () => {
    expect(find(islGraph.edges, 'delegation_quality', 'routine_work_hours_delegated')).toBeDefined();
    expect(find(islGraph.edges, 'human_assistant_capacity', 'routine_work_hours_delegated')).toBeUndefined();
    expect(find(islGraph.edges, 'ai_assistant_use', 'routine_work_hours_delegated')).toBeUndefined();
  });
});
