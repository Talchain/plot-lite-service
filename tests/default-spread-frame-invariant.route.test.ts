/**
 * T7b — "a default spread may never come from the FRAME"
 * (AI Quality science re-rule, olumi-programme-docs #72 5867008723, R3-2 root 1).
 *
 * THE DEFECT (measured on AIQ's served journey-C request, GT1, PLoT aac1970):
 * `feature_development_spend` and `additional_advertising_spend` reach PLoT as
 * CEE-inferred today-levels of 0 with no std. `buildParameterUncertaintiesV3`
 * gave every zero-valued continuous factor FALLBACK_STD = 0.5 — in the factor's
 * NORMALISED units, i.e. half its frame: ±£50,000 on a £100k cap, ±£100,000 on
 * a £200k cap. The spread was a property of the frame, not of anything anyone
 * said about the lever.
 *
 * THE RULE (AIQ): a zero estimate on a factor the options SET takes
 * std = 0.15 × the largest |level| any option sets for it, in the units the
 * std is expressed in on the ISL wire. Journey C: max level 0.2 of £100k →
 * std 0.03 → ±£3,000. With no option level there is no scale: the factor is
 * held at its stated 0 (std = MIN_USER_STD, ISL's minimum admissible normal).
 *
 * The request is AIQ's served one (fixture, byte-identical to the capture);
 * the route is PLoT's REAL POST /v2/run; only the ISL client is mocked, and
 * every assertion reads the ISL request PLoT actually built.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every ISL analysis body, in call order. THE WIRE. */
let islBodies: any[] = [];

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
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islBodies.push(body);
    // Stop after the capture: this suite asserts the REQUEST, not a result.
    return { data: null, error: 'test: stop after capture' };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

const FIXTURE = resolve(__dirname, 'fixtures/journey-c-gt1-default-spread-20260928/cee-to-plot.request.json');
const FEATURES = 'feature_development_spend';
const ADVERTISING = 'additional_advertising_spend';
const LEVERS = [FEATURES, ADVERTISING] as const;
const TALLY = 'six_month_decision_spend';
/** AIQ's rule constant — the same 0.15 a non-zero estimate uses. */
const FRACTION = 0.15;
/** ISL's minimum admissible normal std (PLoT MIN_USER_STD). */
const HOLD_STD = 1e-4;

const gt1 = (): any => JSON.parse(readFileSync(FIXTURE, 'utf8'));

function node(req: any, id: string): any {
  const n = req.graph.nodes.find((x: any) => x.id === id);
  expect(n, `request node ${id}`).toBeDefined();
  return n;
}

/**
 * The SAME decision stated on a £200k frame: each lever's cap doubles, every
 * option level for it (graph option nodes AND the top-level options) halves in
 * normalised units — so every RAW level (level × cap) is unchanged — and the
 * tally's cap (the sum of the two levers' caps) doubles with them.
 */
function onFrame200k(req: any): any {
  for (const id of LEVERS) {
    const os = node(req, id).observed_state;
    expect(os.cap).toBe(100_000);
    os.cap = 200_000;
    for (const n of req.graph.nodes) {
      if (n.kind === 'option' && n.interventions?.[id]) n.interventions[id].value /= 2;
    }
    for (const o of req.options) {
      if (typeof o.interventions?.[id] === 'number') o.interventions[id] /= 2;
    }
  }
  const tally = node(req, TALLY).observed_state;
  expect(tally.cap).toBe(200_000);
  tally.cap = 400_000;
  return req;
}

/** The robustness request PLoT sent to ISL (exactly one per run). */
function wire(): any {
  const bodies = islBodies.filter((b) => Array.isArray(b?.parameter_uncertainties));
  expect(bodies.length, 'exactly one ISL robustness request').toBe(1);
  return bodies[0];
}

/** The PU entry for a node, bound by node_id (never by position or value). */
function wirePu(isl: any, id: string): any {
  const hits = (isl.parameter_uncertainties ?? []).filter((p: any) => p.node_id === id);
  expect(hits.length, `one PU entry for ${id}`).toBe(1);
  return hits[0];
}

/** The node's own frame as it travels on the wire. */
function wireCap(isl: any, id: string): number {
  const n = isl.graph.nodes.find((x: any) => x.id === id);
  expect(n, `wire node ${id}`).toBeDefined();
  expect(typeof n.observed_state?.cap, `wire cap for ${id}`).toBe('number');
  return n.observed_state.cap;
}

/** Every option level set for a factor on the wire, keyed by option id. */
function wireLevels(isl: any, id: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of isl.options) {
    if (typeof o.interventions?.[id] === 'number') out[o.id] = o.interventions[id];
  }
  return out;
}

function maxAbs(levels: Record<string, number>): number {
  return Math.max(0, ...Object.values(levels).map((v) => Math.abs(v)));
}

describe('T7b — a zero estimate on an option-set lever takes its spread from the option levels, never the frame', () => {
  let app: FastifyInstance;

  async function run(req: any): Promise<any> {
    islBodies = [];
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: req });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    return wire();
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  it('row 1 — GT1 as served: each lever\'s std = 0.15 × its largest wire option level (≈ ±£3,000), not FALLBACK 0.5 (±£50,000)', async () => {
    const isl = await run(gt1());
    for (const id of LEVERS) {
      const levels = wireLevels(isl, id);
      // Precondition: the served shape — a zero estimate CEE sent no std for,
      // which the options DO set (0.2 on its own option, 0.05 on the split).
      const src = node(gt1(), id).observed_state;
      expect(src.value).toBe(0);
      expect(src.std).toBeUndefined();
      expect(maxAbs(levels), `${id} wire levels ${JSON.stringify(levels)}`).toBe(0.2);

      const pu = wirePu(isl, id);
      expect(pu.distribution).toBe('normal');
      expect(pu.std).toBe(FRACTION * maxAbs(levels));
      expect(pu.std * wireCap(isl, id)).toBe(3_000);
      expect(pu.std).not.toBe(0.5);
    }
  });

  it('row 2 — FRAME INVARIANCE: the same decision on a £200k frame gives byte-identical RAW stds and raw option levels', async () => {
    const at100k = await run(gt1());
    const at200k = await run(onFrame200k(gt1()));
    for (const id of LEVERS) {
      // The frame really moved on the wire (else the comparison proves nothing)…
      expect(wireCap(at100k, id)).toBe(100_000);
      expect(wireCap(at200k, id)).toBe(200_000);
      // …the decision did not: every option's raw level is identical…
      const raw100 = Object.fromEntries(Object.entries(wireLevels(at100k, id)).map(([k, v]) => [k, v * 100_000]));
      const raw200 = Object.fromEntries(Object.entries(wireLevels(at200k, id)).map(([k, v]) => [k, v * 200_000]));
      expect(Object.keys(raw100).length).toBeGreaterThan(1);
      expect(raw200).toStrictEqual(raw100);
      // …so the raw spread must be identical too.
      const rawStd100 = wirePu(at100k, id).std * wireCap(at100k, id);
      const rawStd200 = wirePu(at200k, id).std * wireCap(at200k, id);
      expect(rawStd200).toBe(rawStd100);
      expect(rawStd100).toBe(3_000);
    }
  });

  it('row 4 — CONTROL: a non-zero estimate keeps 0.15 × |value|, and a CEE-sent std always wins', async () => {
    const req = gt1();
    const features = node(req, FEATURES).observed_state;
    features.value = 0.8;
    features.raw_value = 80_000;
    node(req, ADVERTISING).observed_state.std = 0.07;
    const isl = await run(req);
    expect(wirePu(isl, FEATURES).std).toBe(Math.abs(0.8) * FRACTION);
    expect(wirePu(isl, ADVERTISING).std).toBe(0.07);
    // STATED_LEVEL_STD: the user-stated price travels at CEE's 1e-4, untouched.
    expect(wirePu(isl, 'pro_plan_price').std).toBe(1e-4);
  });

  it('no option sets the zero lever to a non-zero level: it is HELD at its stated 0 (MIN_USER_STD), never sampled at ±frame (AIQ to confirm)', async () => {
    // Every option still intervenes on the lever (removing it would leave the
    // features option with no path to the spend goal — a 422, not this shape),
    // but none at a non-zero level: there is no scale to take a spread from.
    const req = gt1();
    for (const n of req.graph.nodes) {
      if (n.kind === 'option' && n.interventions?.[FEATURES]) {
        n.interventions[FEATURES].value = 0;
        delete n.interventions[FEATURES].raw_value;
      }
    }
    for (const o of req.options) {
      if (typeof o.interventions?.[FEATURES] === 'number') o.interventions[FEATURES] = 0;
    }
    const isl = await run(req);
    const levels = wireLevels(isl, FEATURES);
    expect(Object.keys(levels).length).toBeGreaterThan(1);
    expect(maxAbs(levels)).toBe(0);
    expect(wirePu(isl, FEATURES).std).toBe(HOLD_STD);
    // Contrast in the same run: the sibling lever the options still set keeps its rule.
    expect(wirePu(isl, ADVERTISING).std).toBe(FRACTION * 0.2);
  });

  it('options stated RAW (normalisation gate open): the std reads the NORMALISED wire levels, identical to the unit-scale spelling', async () => {
    const req = gt1();
    const raw: Record<string, Record<string, number>> = {
      features_pro_price_rise: { pro_plan_price: 59, [FEATURES]: 20_000 },
      additional_advertising: { [ADVERTISING]: 20_000 },
      carry_on_as_now: { [FEATURES]: 0, pro_plan_price: 49, [ADVERTISING]: 0 },
      '6526b52c': { [FEATURES]: 5_000, [ADVERTISING]: 5_000 },
    };
    for (const o of req.options) o.interventions = raw[o.id];
    const isl = await run(req);
    for (const id of LEVERS) {
      const levels = wireLevels(isl, id);
      expect(maxAbs(levels), `${id} normalised wire levels ${JSON.stringify(levels)}`).toBeCloseTo(0.2, 12);
      expect(wirePu(isl, id).std).toBe(FRACTION * maxAbs(levels));
      expect(wirePu(isl, id).std * wireCap(isl, id)).toBeCloseTo(3_000, 6);
    }
  });
});
