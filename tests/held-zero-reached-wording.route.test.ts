/**
 * ZERO_FACTOR_HELD_EXACT says "with no uncertainty" ONLY for a zero no option reaches
 * (AI Quality, olumi-programme-docs #72 5871640445 — served journey E on PLoT b4eaa0c).
 *
 * THE DEFECT: PLoT #392 (T7b 4b) named every held zero with "Olumi holds "<label>" at 0 … with
 * no uncertainty; give a range if it can vary." On served E that was said of "Engineering
 * delivery capacity" (0 FTE-equivalents) and "Annual salary spend" (£0). Both are NON-ROOT:
 * their parents are the senior and junior hire levers every option sets, so the analysis MOVES
 * them — only their STARTING level is held exact. The sentence was false.
 *
 * THE RULE (AIQ): "no uncertainty" only when no directed path runs from any option-set node to
 * it. A zero an option reaches (directly or through parents) is told the true thing: its
 * starting level is held exact and the options still move it. Same typed code.
 *
 * The request is AIQ's served E request, byte-identical to the capture
 * (programme-docs 446df48 `aiq-p2-20260927/contract-probe/E-4f10a5d0-reconstructed.request.json`,
 * sha256 35ea3640…, the `source_sha256` of AIQ's E report). The route is PLoT's REAL
 * POST /v2/run; only the ISL client is mocked (a computed response for whatever options PLoT
 * sends), and every assertion reads the RESPONSE PLoT built, bound by node label.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeOptionResultV2 } from './helpers/isl-option-fixture.js';

/** Every ISL robustness body PLoT sent, in call order. */
let islBodies: any[] = [];

function computedFor(body: any): Record<string, unknown> {
  return {
    analysis_status: 'computed',
    seed_used: 42,
    options: (body.options ?? []).map((o: any, i: number) =>
      makeOptionResultV2({
        id: o.id,
        outcome: { mean: 0.4 + 0.05 * i, std: 0.05, p10: 0.3, p50: 0.4 + 0.05 * i, p90: 0.6, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
        win_probability: 1 / Math.max(1, body.options.length),
        status: 'computed',
      })),
    factor_sensitivity: [],
    robustness: { confidence: 0.8, level: 'high', is_robust: true, fragile_edges: [], robust_edges: [] },
    inference_warnings: [],
  };
}

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [],
      issues: [], explanation: { summary: 'mock', reasoning: 'test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8,
      latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<unknown> {
    islBodies.push(body);
    return { data: computedFor(body) as T, latency_ms: 5, isl_echoed_request_id: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

const FIXTURE = resolve(__dirname, 'fixtures/journey-e-held-zero-20260928/cee-to-plot.request.json');
const servedE = (): any => JSON.parse(readFileSync(FIXTURE, 'utf8'));

const NO_UNCERTAINTY = (label: string, zero: string) =>
  `Olumi holds "${label}" at ${zero} with no uncertainty; give a range if it can vary.`;
const START_HELD = (label: string, zero: string) =>
  `Olumi holds the starting level of "${label}" at ${zero} exactly; the options still move it.`;

describe('/v2/run — served journey E: ZERO_FACTOR_HELD_EXACT tells the truth about a reached zero (AIQ #72 5871640445)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function heldWarnings(body: any): Promise<{ held: Record<string, string>; isl: any }> {
    islBodies = [];
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: body });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    const json = res.json();
    const rows = (json.inference_warnings ?? []).filter((w: any) => w.code === 'ZERO_FACTOR_HELD_EXACT');
    const held: Record<string, string> = {};
    for (const w of rows) {
      expect(held[w.node_label], `one ZERO_FACTOR_HELD_EXACT per node (${w.node_label})`).toBeUndefined();
      expect(w.severity).toBe('info');
      held[w.node_label] = w.message;
    }
    const robustness = islBodies.filter((b) => Array.isArray(b?.parameter_uncertainties));
    expect(robustness.length, 'exactly one ISL robustness request').toBe(1);
    return { held, isl: robustness[0] };
  }

  it('⭐ ROW (served E, byte-identical request): both non-root zeros read "starting level … exactly; the options still move it" — never "no uncertainty"', async () => {
    const { held, isl } = await heldWarnings(servedE());
    expect(held).toEqual({
      'Engineering delivery capacity': START_HELD('Engineering delivery capacity', '0 FTE-equivalents'),
      'Annual salary spend': START_HELD('Annual salary spend', '£0'),
    });
    for (const message of Object.values(held)) expect(message).not.toContain('no uncertainty');
    // Unchanged by this fix: both starting levels still go out exact.
    for (const id of ['engineering_delivery_capacity', 'annual_salary_spend']) {
      expect(isl.parameter_uncertainties.filter((p: any) => p.node_id === id)).toStrictEqual([{ node_id: id, distribution: 'point_mass' }]);
    }
  });

  it('CONTRAST (same request + a zero ROOT no option touches): the root keeps "no uncertainty"; the reached zeros keep "starting level"', async () => {
    const body = servedE();
    body.graph.nodes.push({ id: 'office_rent', kind: 'factor', label: 'Office rent', category: 'external', observed_state: { value: 0, unit: 'GBP/year' } });
    body.graph.edges.push({ from: 'office_rent', to: 'ship_the_new_platform', exists_probability: 0.8, strength: { mean: -0.2, std: 0.05 } });
    const { held, isl } = await heldWarnings(body);
    expect(held).toEqual({
      'Engineering delivery capacity': START_HELD('Engineering delivery capacity', '0 FTE-equivalents'),
      'Annual salary spend': START_HELD('Annual salary spend', '£0'),
      'Office rent': NO_UNCERTAINTY('Office rent', '£0'),
    });
    expect(isl.parameter_uncertainties.filter((p: any) => p.node_id === 'office_rent')).toStrictEqual([{ node_id: 'office_rent', distribution: 'point_mass' }]);
  });
});
