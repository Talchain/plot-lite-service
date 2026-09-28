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
 * std 0.03 → ±£3,000. A zero factor NO option touches keeps the base
 * FALLBACK_STD path (Verifier FIX_FIRST: no silent 1e-4 hold).
 *
 * THE AMENDED RULE (AIQ #72 5867604513 + 5867934055): ISL's sum identity
 * computes a plan's tally as today + (plan − this draw's status-quo operands),
 * so ANY spread on today's level leaks into an exact plan total. A controllable
 * lever an option sets EXACTLY to its today level — where that level is the
 * user's own or exactly 0 — is PINNED and goes out as point_mass. GT1 as served
 * pins both spend levers (carry-on sets them to their £0 today) and the Pro
 * price (brief_extraction £49, echoed by carry-on). The 0.15 × max rule is
 * exercised on the CONTROL-2 shape: no option at today's level.
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
/** PLoT FALLBACK_STD — the base path for a zero factor no option touches. */
const FALLBACK = 0.5;
/** The golden fixture whose `fac_hiring_cost` no option touches (Verifier row). */
const GOLDEN_REQUEST = resolve(__dirname, 'fixtures/isl-v2-live-20260707/isl-v2-request.json');

const gt1 = (): any => JSON.parse(readFileSync(FIXTURE, 'utf8'));

/**
 * AIQ CONTROL-2 shape on GT1: the carry-on option no longer sets the spend
 * levers to their £0 today (it sets £1,000 instead), so NO option is at today's
 * level and nothing pins them. Removing the carry-on interventions outright
 * would leave that option with no path to the spend goal.
 */
function withoutTodayEcho(req: any): any {
  for (const n of req.graph.nodes) {
    if (n.id === 'carry_on_as_now' && n.interventions) {
      for (const id of LEVERS) if (n.interventions[id]) n.interventions[id].value = 0.01;
    }
  }
  for (const o of req.options) {
    if (o.id !== 'carry_on_as_now') continue;
    for (const id of LEVERS) {
      expect(o.interventions[id], `carry_on_as_now sets ${id}`).toBe(0);
      o.interventions[id] = 0.01;
    }
  }
  return req;
}

/** The golden /v2/run body, built exactly as isl-v2-golden-response.pin.test.ts builds it. */
function goldenBody(): any {
  const requestA = JSON.parse(readFileSync(GOLDEN_REQUEST, 'utf8'));
  return {
    graph: {
      nodes: requestA.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: requestA.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: requestA.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [nodeId, { value, source: 'user_specified' }]),
      ),
    })),
    goal_node_id: requestA.goal_node_id,
    seed: String(requestA.seed),
  };
}

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

describe('T7b — a zero estimate on an option-set lever takes its spread from the option levels, never the frame; a PINNED lever is held exact', () => {
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

  it('GT1 ROW — as served: both spend levers (today £0, cee_inference; carry-on sets £0) go out as point_mass, never a sampled normal', async () => {
    const isl = await run(gt1());
    for (const id of LEVERS) {
      // Precondition: the served shape — a controllable zero estimate CEE sent
      // no std for, which the carry-on option sets to exactly that 0.
      const src = node(gt1(), id);
      expect(src.category).toBe('controllable');
      expect(src.observed_state.value).toBe(0);
      expect(src.observed_state.source).toBe('cee_inference');
      expect(src.observed_state.std).toBeUndefined();
      const levels = wireLevels(isl, id);
      expect(levels.carry_on_as_now, `${id} wire levels ${JSON.stringify(levels)}`).toBe(0);
      expect(maxAbs(levels)).toBe(0.2);

      expect(wirePu(isl, id)).toStrictEqual({ node_id: id, distribution: 'point_mass' });
    }
    // The tally carrier really is the sum of the two pinned levers on this request.
    const tally = isl.graph.nodes.find((n: any) => n.id === TALLY);
    expect(tally?.nonlinear_identity?.operation).toBe('sum');
    expect([...tally.nonlinear_identity.factor_ids].sort()).toStrictEqual([...LEVERS].sort());
  });

  it('AIQ CONTROL 1 on the served request: the user-stated Pro price (brief_extraction £49, CEE std 1e-4) echoed by carry-on → point_mass', async () => {
    const src = node(gt1(), 'pro_plan_price');
    expect(src.observed_state.source).toBe('brief_extraction');
    expect(src.observed_state.std).toBe(1e-4);
    const isl = await run(gt1());
    expect(wireLevels(isl, 'pro_plan_price').carry_on_as_now).toBe(src.observed_state.value);
    expect(wirePu(isl, 'pro_plan_price')).toStrictEqual({ node_id: 'pro_plan_price', distribution: 'point_mass' });
    // Contrast in the same run: observable factors are never pinned.
    expect(wirePu(isl, 'monthly_churn').distribution).toBe('normal');
  });

  it('AIQ CONTROL 2: no option at today\'s level → each lever\'s std = 0.15 × its largest wire option level (≈ ±£3,000), not FALLBACK 0.5 (±£50,000)', async () => {
    const isl = await run(withoutTodayEcho(gt1()));
    for (const id of LEVERS) {
      const levels = wireLevels(isl, id);
      expect(Object.values(levels)).not.toContain(0);
      expect(maxAbs(levels), `${id} wire levels ${JSON.stringify(levels)}`).toBe(0.2);
      const pu = wirePu(isl, id);
      expect(pu.distribution).toBe('normal');
      expect(pu.std).toBe(FRACTION * maxAbs(levels));
      expect(pu.std * wireCap(isl, id)).toBe(3_000);
    }
  });

  it('FRAME INVARIANCE (Control-2 shape): the same decision on a £200k frame gives byte-identical RAW stds and raw option levels', async () => {
    const at100k = await run(withoutTodayEcho(gt1()));
    const at200k = await run(onFrame200k(withoutTodayEcho(gt1())));
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

  it('FRAME INVARIANCE of the pin: the served decision on a £200k frame is still point_mass for both levers', async () => {
    const isl = await run(onFrame200k(gt1()));
    for (const id of LEVERS) {
      expect(wireCap(isl, id)).toBe(200_000);
      expect(wirePu(isl, id)).toStrictEqual({ node_id: id, distribution: 'point_mass' });
    }
  });

  it('PRECEDENCE: a CEE-sent std loses to a pin, and wins when the lever is not pinned; a non-zero Olumi estimate keeps 0.15 × |value|', async () => {
    const pinnedReq = gt1();
    node(pinnedReq, ADVERTISING).observed_state.std = 0.07;
    const features = node(pinnedReq, FEATURES).observed_state;
    features.value = 0.8;
    features.raw_value = 80_000;
    const pinned = await run(pinnedReq);
    expect(wirePu(pinned, ADVERTISING)).toStrictEqual({ node_id: ADVERTISING, distribution: 'point_mass' });
    // cee_inference £80,000, carry-on sets £0 ≠ today: not pinned, the non-zero rule.
    expect(wirePu(pinned, FEATURES)).toStrictEqual({ node_id: FEATURES, distribution: 'normal', std: Math.abs(0.8) * FRACTION });

    const unpinnedReq = withoutTodayEcho(gt1());
    node(unpinnedReq, ADVERTISING).observed_state.std = 0.07;
    const unpinned = await run(unpinnedReq);
    expect(wirePu(unpinned, ADVERTISING)).toStrictEqual({ node_id: ADVERTISING, distribution: 'normal', std: 0.07 });
  });

  it('VERIFIER ROW — golden fac_hiring_cost (value 0, no option touches it) keeps the base path byte-for-byte: normal, std 0.5, never 1e-4', async () => {
    const body = goldenBody();
    for (const o of body.options) expect(Object.keys(o.interventions)).not.toContain('fac_hiring_cost');
    const isl = await run(body);
    expect(wirePu(isl, 'fac_hiring_cost')).toStrictEqual({ node_id: 'fac_hiring_cost', distribution: 'normal', std: FALLBACK });
    // Contrast in the same run: the zero factors the options DO set take 0.15 × max|level| (= 1).
    expect(wirePu(isl, 'fac_dev_headcount')).toStrictEqual({ node_id: 'fac_dev_headcount', distribution: 'normal', std: FRACTION * 1 });
    expect(wirePu(isl, 'fac_tech_lead')).toStrictEqual({ node_id: 'fac_tech_lead', distribution: 'normal', std: FRACTION * 1 });
  });

  it('options stated RAW (normalisation gate open): pin and spread both read the NORMALISED wire levels', async () => {
    const req = gt1();
    const raw: Record<string, Record<string, number>> = {
      features_pro_price_rise: { pro_plan_price: 59, [FEATURES]: 20_000 },
      additional_advertising: { [ADVERTISING]: 20_000 },
      carry_on_as_now: { [FEATURES]: 1_000, pro_plan_price: 49, [ADVERTISING]: 1_000 },
      '6526b52c': { [FEATURES]: 5_000, [ADVERTISING]: 5_000 },
    };
    for (const o of req.options) o.interventions = raw[o.id];
    for (const n of req.graph.nodes) {
      if (n.id === 'carry_on_as_now' && n.interventions) {
        for (const id of LEVERS) if (n.interventions[id]) n.interventions[id].value = 0.01;
      }
    }
    const isl = await run(req);
    // Raw £49 is today's 0.245 only in normalised units: pinned by the normalised comparison.
    expect(wireLevels(isl, 'pro_plan_price').carry_on_as_now).toBeCloseTo(0.245, 12);
    expect(wirePu(isl, 'pro_plan_price')).toStrictEqual({ node_id: 'pro_plan_price', distribution: 'point_mass' });
    for (const id of LEVERS) {
      const levels = wireLevels(isl, id);
      expect(maxAbs(levels), `${id} normalised wire levels ${JSON.stringify(levels)}`).toBeCloseTo(0.2, 12);
      expect(wirePu(isl, id).std).toBe(FRACTION * maxAbs(levels));
      expect(wirePu(isl, id).std * wireCap(isl, id)).toBeCloseTo(3_000, 6);
    }
  });

  it('a pinned lever named in factor_correlations goes out as a normal at MIN_USER_STD (ISL 422s a correlated point_mass); its unnamed sibling stays point_mass', async () => {
    const req = gt1();
    req.factor_correlations = [{ factor_a: FEATURES, factor_b: 'monthly_churn', rho: 0.2 }];
    const isl = await run(req);
    expect(isl.factor_correlations).toStrictEqual(req.factor_correlations);
    expect(wirePu(isl, FEATURES)).toStrictEqual({ node_id: FEATURES, distribution: 'normal', std: 1e-4 });
    expect(wirePu(isl, ADVERTISING)).toStrictEqual({ node_id: ADVERTISING, distribution: 'point_mass' });
  });
});
