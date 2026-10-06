/**
 * G4 / G5 — the precision and the drivers of an option's goal chance reach PLoT's egress.
 *
 * ISL #224 emits `probability_of_goal_precision` and `probability_of_goal_drivers` beside each
 * option's `probability_of_goal`. PLoT builds every `option_comparison` row by explicit field
 * selection (routes/v2/run.ts), so both blocks died here. This suite pins the carriage:
 *   1  each option carries its OWN blocks (bound by option id AND label, siblings differ);
 *   2  they ride ONLY with the figure: a withheld or invalid figure carries neither;
 *   3  a block or row that is not honest is omitted or dropped and counted, never repaired;
 *   4  a FACTOR cut is also given in the user's units, from the factor's own cap, and only when
 *      the cut lies inside the factor's range. A link cut never is.
 *
 * Rows run on the real W214 ISL answer and request (tests/fixtures/r3b-goal-derived-withhold-20260929/),
 * the fixture `clamped-user-effect-withhold.route.test.ts` uses. The two blocks are a constructed
 * addition in ISL #224's shape: that capture predates them, and its figures are all 0.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import Ajv from 'ajv';
import { buildGoalChanceDrivers, buildGoalChancePrecision } from '../src/routes/v2/numeric-egress-guards.js';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/r3b-goal-derived-withhold-20260929');
const ISL_BODY = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'isl-analyze-v2.response.json'), 'utf8'));
const REQUEST = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'plot-v2-run.request.json'), 'utf8'));

/** What the mocked ISL answers next: the captured body with these top-level keys replaced. */
let islOverride: Record<string, unknown> = {};

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(): Promise<never> { throw new Error('not called'); },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: unknown }> {
    return { data: { ...structuredClone(ISL_BODY), ...structuredClone(islOverride) } as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// ---------------------------------------------------------------------------
// Fixtures — ISL #224's shape. The two options carry DIFFERENT values throughout.
// ---------------------------------------------------------------------------

const CONVERSION = { id: '6dbac00d', label: 'Improve trial-to-Pro conversion' };
const RETENTION = { id: 'ca47b368', label: 'Retention intervention for at-risk accounts' };
const NO_BLOCKS = { id: 'increase_price_to_59', label: 'Increase price to £59' };

const precisionFor = (nMet: number, lower: number, upper: number) => ({
  basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
  n_informative: 1000, n_met: nMet, interval_lower: lower, interval_upper: upper,
});

/** `monthly_churn` has NO cap on the request graph: its cut has no user unit. */
const CHURN_ROW = {
  quantity_id: 'monthly_churn', kind: 'factor_value',
  p_goal_if_low: 0.7, p_goal_if_high: 0.1, n_low: 333, n_high: 333,
  low_upper_value: 0.021, high_lower_value: 0.041,
  spread: 0.6, spread_noise_floor: 0.11, status: 'resolved',
};
/** `pro_plan_price` is capped at 200 "GBP per month": 0.24 and 0.25 are £48 and £50. */
const PRICE_ROW = {
  quantity_id: 'pro_plan_price', kind: 'factor_value',
  p_goal_if_low: 0.3, p_goal_if_high: 0.5, n_low: 333, n_high: 333,
  low_upper_value: 0.24, high_lower_value: 0.25,
  spread: 0.2, spread_noise_floor: 0.11, status: 'resolved', correlated: true,
};
const LINK = { from: 'pro_paying_subscribers', to: 'mrr' };
const STRENGTH_ROW = {
  quantity_id: 'pro_paying_subscribers->mrr', kind: 'link_strength', ...LINK,
  p_goal_if_low: 0.35, p_goal_if_high: 0.45, n_low: 266, n_high: 266,
  low_upper_value: 0.12, high_lower_value: 0.18,
  spread: 0.1, spread_noise_floor: 0.12, status: 'below_resolution',
};
const EXISTENCE_ROW = {
  quantity_id: 'pro_paying_subscribers->mrr', kind: 'link_existence', ...LINK,
  p_goal_if_absent: 0.02, p_goal_if_present: 0.495, n_absent: 200, n_present: 800,
  spread: 0.475, spread_noise_floor: 0.1, status: 'resolved',
};
const driversWith = (rows: unknown[]) => ({
  method: 'tercile_conditional_v1', min_group_n: 30,
  n_candidates: 25, n_compared: 23, n_dropped: 2,
  dropped_by_reason: {
    outcome_constant: 0, no_variance: 1, group_below_min_n: 0, tied_at_tercile_boundary: 0,
    set_by_option: 1, non_finite_values: 0, zero_spread: 0,
  },
  drivers: rows,
});

const CONVERSION_BLOCKS = {
  probability_of_goal: 0.4,
  probability_of_goal_precision: precisionFor(400, 0.37, 0.431),
  probability_of_goal_drivers: driversWith([CHURN_ROW, EXISTENCE_ROW, PRICE_ROW, STRENGTH_ROW]),
};
/** The price cut's low side sits below zero (a draw-based cut can), and one row is malformed. */
const PRICE_ROW_LOW_CUT_BELOW_ZERO = { ...PRICE_ROW, low_upper_value: -0.01, p_goal_if_low: 0.2, spread: 0.3 };
const MALFORMED_ROW = { ...CHURN_ROW, p_goal_if_low: 1.5 };
const RETENTION_BLOCKS = {
  probability_of_goal: 0.25,
  probability_of_goal_precision: precisionFor(250, 0.224, 0.278),
  probability_of_goal_drivers: driversWith([MALFORMED_ROW, PRICE_ROW_LOW_CUT_BELOW_ZERO]),
};

/** The captured ISL options with the given fields laid over the named options. */
function islOptionsWith(byId: Record<string, Record<string, unknown>>): unknown[] {
  return structuredClone(ISL_BODY.options).map((o: any) => ({ ...o, ...(byId[o.id] ?? {}) }));
}
const BOTH_OPTIONS = { [CONVERSION.id]: CONVERSION_BLOCKS, [RETENTION.id]: RETENTION_BLOCKS };

const GOAL_LINK = (e: any) => e.from === 'pro_paying_subscribers' && e.to === 'mrr';
/** W214 with the goal-path link sized as the user's own, at `mean`: 0.15 is in range, 4.61 is cut. */
function withUserLink(mean: number): any {
  const d = structuredClone(REQUEST);
  const e = d.graph.edges.find(GOAL_LINK);
  e.strength = { ...e.strength, mean };
  e.provenance = { ...(e.provenance ?? {}), source: 'brief_extraction', magnitude: 'user_stated' };
  return d;
}

const NEW_KEYS = ['probability_of_goal_precision', 'probability_of_goal_drivers'] as const;

/** Select an option_comparison entry BY IDENTITY: the id selects it, the exact label is re-asserted. */
function optionByIdentity(body: any, option: { id: string; label: string }): any {
  const entry = (body.option_comparison ?? []).find((o: any) => o.option_id === option.id);
  expect(entry, `option_comparison entry for ${option.id}`).toBeDefined();
  expect(entry.option_label, `identity of ${option.id}`).toBe(option.label);
  return entry;
}
/** The `properties` object of the published contract that declares `key`. */
function publishedPropertiesDeclaring(node: any, key: string): any {
  if (!node || typeof node !== 'object') return undefined;
  if (node.properties && key in node.properties) return node.properties;
  for (const child of Object.values(node)) {
    const found = publishedPropertiesDeclaring(child, key);
    if (found) return found;
  }
  return undefined;
}
const rowFor = (entry: any, quantityId: string, kind: string) => {
  const rows = entry.probability_of_goal_drivers.drivers.filter((r: any) => r.quantity_id === quantityId && r.kind === kind);
  expect(rows, `${kind} row for ${quantityId}`).toHaveLength(1);
  return rows[0];
};

describe('route — goal-chance precision and drivers reach option_comparison (G4 / G5)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  async function run(payload: any) {
    const res = await fetch(`${baseUrl}/v2/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    expect(res.status).toBe(200);
    return res.json();
  }
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => { await app?.close(); });
  afterEach(() => { islOverride = {}; });

  it('carries EACH option its OWN precision and drivers, beside its own figure', async () => {
    islOverride = { options: islOptionsWith(BOTH_OPTIONS) };
    const body = await run(withUserLink(0.15));

    const conversion = optionByIdentity(body, CONVERSION);
    expect(conversion.probability_of_goal).toBe(0.4);
    expect(conversion.probability_of_goal_precision).toEqual(CONVERSION_BLOCKS.probability_of_goal_precision);
    const drivers = conversion.probability_of_goal_drivers;
    expect({ ...drivers, drivers: undefined }).toEqual({ ...CONVERSION_BLOCKS.probability_of_goal_drivers, drivers: undefined });
    expect(drivers.drivers.map((r: any) => [r.quantity_id, r.kind])).toEqual([
      ['monthly_churn', 'factor_value'],
      ['pro_paying_subscribers->mrr', 'link_existence'],
      ['pro_plan_price', 'factor_value'],
      ['pro_paying_subscribers->mrr', 'link_strength'],
    ]);
    expect(rowFor(conversion, 'pro_paying_subscribers->mrr', 'link_existence')).toEqual(EXISTENCE_ROW);
    expect('invalid_rows_dropped' in drivers).toBe(false);

    const retention = optionByIdentity(body, RETENTION);
    expect(retention.probability_of_goal).toBe(0.25);
    expect(retention.probability_of_goal_precision).toEqual(RETENTION_BLOCKS.probability_of_goal_precision);
    expect(retention.probability_of_goal_drivers.n_candidates).toBe(25);

    // An option ISL sent no blocks for carries neither key (absent in, absent out).
    const plain = optionByIdentity(body, NO_BLOCKS);
    expect(typeof plain.probability_of_goal).toBe('number');
    for (const key of NEW_KEYS) expect(key in plain, `${NO_BLOCKS.id}.${key}`).toBe(false);
  });

  it('gives a FACTOR cut in the user\'s units from its cap, and no other cut', async () => {
    islOverride = { options: islOptionsWith(BOTH_OPTIONS) };
    const body = await run(withUserLink(0.15));
    const conversion = optionByIdentity(body, CONVERSION);

    // Capped at 200 "GBP per month": the raw cuts stay, the user-unit cuts are added.
    expect(rowFor(conversion, 'pro_plan_price', 'factor_value')).toEqual({
      ...PRICE_ROW, low_upper_display: 48, high_lower_display: 50, display_unit: 'GBP per month',
    });
    // No cap on the factor: no user-unit cut is claimed.
    expect(rowFor(conversion, 'monthly_churn', 'factor_value')).toEqual(CHURN_ROW);
    // A link-strength cut is a model coefficient: never given a user unit.
    expect(rowFor(conversion, 'pro_paying_subscribers->mrr', 'link_strength')).toEqual(STRENGTH_ROW);
  });

  it('gives no user-unit cut on the side that falls outside the factor\'s own range', async () => {
    islOverride = { options: islOptionsWith(BOTH_OPTIONS) };
    const retention = optionByIdentity(await run(withUserLink(0.15)), RETENTION);

    const row = rowFor(retention, 'pro_plan_price', 'factor_value');
    expect(row.low_upper_value).toBe(-0.01); // the raw cut is kept
    expect('low_upper_display' in row, 'a price below zero is never worded').toBe(false);
    expect(row.high_lower_display).toBe(50);
    expect(row.display_unit).toBe('GBP per month');
  });

  it('drops a row that is not honest and counts it, keeping the rest', async () => {
    islOverride = { options: islOptionsWith(BOTH_OPTIONS) };
    const retention = optionByIdentity(await run(withUserLink(0.15)), RETENTION);

    const drivers = retention.probability_of_goal_drivers;
    expect(drivers.drivers.map((r: any) => r.quantity_id)).toEqual(['pro_plan_price']);
    expect(drivers.invalid_rows_dropped).toBe(1);
  });

  it('the published contract describes both blocks as they are carried', async () => {
    const spec = parse(readFileSync(resolve(__dirname, '../contracts/openapi.yaml'), 'utf8'));
    const published = publishedPropertiesDeclaring(spec, 'probability_of_goal_drivers');
    expect(published, 'openapi.yaml declares probability_of_goal_drivers').toBeDefined();
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validPrecision = ajv.compile(published.probability_of_goal_precision);
    const validDrivers = ajv.compile(published.probability_of_goal_drivers);
    islOverride = { options: islOptionsWith(BOTH_OPTIONS) };
    const body = await run(withUserLink(0.15));

    for (const option of [CONVERSION, RETENTION]) {
      const entry = optionByIdentity(body, option);
      expect(validPrecision(entry.probability_of_goal_precision), JSON.stringify(validPrecision.errors)).toBe(true);
      expect(validDrivers(entry.probability_of_goal_drivers), JSON.stringify(validDrivers.errors)).toBe(true);
    }
    // Discriminating controls: the contract refuses what the guard refuses.
    expect(validPrecision({ ...CONVERSION_BLOCKS.probability_of_goal_precision, basis: 'model_uncertainty' })).toBe(false);
    expect(validDrivers(driversWith([{ ...CHURN_ROW, kind: 'node_value' }]))).toBe(false);
    expect(validDrivers(driversWith([{ ...CHURN_ROW, p_goal_if_low: 1.5 }]))).toBe(false);
  });

  it('⭐ a WITHHELD figure carries neither block (the user-stated link cut to the model\'s scale)', async () => {
    islOverride = { options: islOptionsWith(BOTH_OPTIONS) };
    // Precondition: ISL put both blocks on the wire for these options.
    for (const id of [CONVERSION.id, RETENTION.id]) {
      const sent = (islOverride.options as any[]).find((o) => o.id === id);
      for (const key of NEW_KEYS) expect(sent[key], `mock ${id}.${key}`).toBeDefined();
    }
    const control = await run(withUserLink(0.15));
    const body = await run(withUserLink(4.61));

    for (const key of NEW_KEYS) expect(optionByIdentity(control, CONVERSION)[key], `control ${key}`).toBeDefined();
    expect(body.option_comparison.length).toBeGreaterThan(0);
    for (const o of body.option_comparison) {
      expect('probability_of_goal' in o, `${o.option_id}.probability_of_goal`).toBe(false);
      for (const key of NEW_KEYS) expect(key in o, `${o.option_id}.${key}`).toBe(false);
    }
  });

  it('a figure ISL sent out of range carries neither block', async () => {
    islOverride = { options: islOptionsWith({ [CONVERSION.id]: { ...CONVERSION_BLOCKS, probability_of_goal: 1.5 }, [RETENTION.id]: RETENTION_BLOCKS }) };
    const body = await run(withUserLink(0.15));

    const conversion = optionByIdentity(body, CONVERSION);
    expect('probability_of_goal' in conversion).toBe(false);
    for (const key of NEW_KEYS) expect(key in conversion, key).toBe(false);
    // Control in the same response: the sibling's figure is fine and carries both.
    for (const key of NEW_KEYS) expect(optionByIdentity(body, RETENTION)[key], `sibling ${key}`).toBeDefined();
  });

  it('a precision block that does not reproduce the figure is omitted; the figure and drivers stay', async () => {
    const offByOne = { ...CONVERSION_BLOCKS, probability_of_goal_precision: precisionFor(399, 0.37, 0.431) };
    islOverride = { options: islOptionsWith({ [CONVERSION.id]: offByOne }) };
    const conversion = optionByIdentity(await run(withUserLink(0.15)), CONVERSION);

    expect(conversion.probability_of_goal).toBe(0.4);
    expect('probability_of_goal_precision' in conversion).toBe(false);
    expect(conversion.probability_of_goal_drivers.drivers).toHaveLength(4);
  });
});

describe('buildGoalChanceDrivers — a row is carried whole or dropped and counted', () => {
  const only = (row: unknown) => buildGoalChanceDrivers(driversWith([row, CHURN_ROW]));

  it.each([
    ['a probability above 1', { ...PRICE_ROW, p_goal_if_low: 1.5 }],
    ['a null probability', { ...PRICE_ROW, p_goal_if_high: null }],
    ['a zero spread (ISL never lists one)', { ...PRICE_ROW, spread: 0 }],
    ['a spread above 1', { ...PRICE_ROW, spread: 1.2 }],
    ['a negative noise floor', { ...PRICE_ROW, spread_noise_floor: -0.1 }],
    ['a kind off the vocabulary', { ...PRICE_ROW, kind: 'node_value' }],
    ['a status off the vocabulary', { ...PRICE_ROW, status: 'significant' }],
    ['an empty group', { ...PRICE_ROW, n_low: 0 }],
    ['a fractional count', { ...PRICE_ROW, n_high: 333.5 }],
    ['a cut that is not a number', { ...PRICE_ROW, low_upper_value: null }],
    ['a missing quantity id', { ...PRICE_ROW, quantity_id: '' }],
    ['a link with one end missing', { ...STRENGTH_ROW, to: undefined }],
    ['an existence row with no present count', { ...EXISTENCE_ROW, n_present: undefined }],
    ['a correlated flag that is not a boolean', { ...PRICE_ROW, correlated: 'yes' }],
    ['a row that is not an object', 'pro_plan_price'],
  ])('%s', (_name, row) => {
    const built = only(row)!;
    expect(built.drivers).toEqual([CHURN_ROW]);
    expect(built.invalid_rows_dropped).toBe(1);
  });

  it('CONTROL — the same rows unbroken are all carried, with nothing counted', () => {
    const built = buildGoalChanceDrivers(driversWith([PRICE_ROW, STRENGTH_ROW, EXISTENCE_ROW, CHURN_ROW]))!;
    expect(built.drivers).toEqual([PRICE_ROW, STRENGTH_ROW, EXISTENCE_ROW, CHURN_ROW]);
    expect('invalid_rows_dropped' in built).toBe(false);
  });

  it.each([
    ['a method off the vocabulary', { method: 'tercile_v2' }],
    ['a count that is not a whole number', { n_compared: 2.5 }],
    ['a reason count that is negative', { dropped_by_reason: { no_variance: -1 } }],
    ['reasons that are not an object', { dropped_by_reason: [1] }],
    ['drivers that are not a list', { drivers: { 0: CHURN_ROW } }],
  ])('the whole block is omitted on %s', (_name, patch) => {
    expect(buildGoalChanceDrivers({ ...driversWith([CHURN_ROW]), ...patch })).toBeUndefined();
  });
});

describe('buildGoalChancePrecision — carried whole, and only beside the figure it describes', () => {
  const good = precisionFor(400, 0.37, 0.431);

  it('CONTROL — an honest block is carried verbatim', () => {
    expect(buildGoalChancePrecision(good, 0.4)).toEqual(good);
    // A measured zero is not an absence.
    const zero = precisionFor(0, 0, 0.0038);
    expect(buildGoalChancePrecision(zero, 0)).toEqual(zero);
  });

  it.each([
    ['a basis off the vocabulary', { basis: 'model_uncertainty' }],
    ['a method off the vocabulary', { method: 'normal_approximation' }],
    ['a confidence level of 1', { confidence_level: 1 }],
    ['no informative draws', { n_informative: 0, n_met: 0 }],
    ['more hits than draws', { n_met: 1001 }],
    ['hits that do not reproduce the figure', { n_met: 399 }],
    ['an interval that does not hold the figure', { interval_lower: 0.41 }],
    ['a bound above 1', { interval_upper: 1.2 }],
    ['a null bound', { interval_lower: null }],
  ])('omitted on %s', (_name, patch) => {
    expect(buildGoalChancePrecision({ ...good, ...patch }, 0.4)).toBeUndefined();
  });
});
