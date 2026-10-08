import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv from 'ajv';
import * as admission from '../src/integrations/isl/compute-admission.js';
import { toISLNode, type ISLRobustnessRequestV3 } from '../src/integrations/isl/translator-v3.js';
import { normaliseGraph } from '../src/normalisation/graph-normaliser.js';
import { makeComputedIslResponse, makeValidRunBody } from './helpers/run-fixtures.js';

const ACCUMULATION_EVALUATION = {
  node_id: 'subscribers_at_horizon',
  operation: 'accumulation',
  factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
  stated_in_brief: false,
  evaluated: true,
  horizon_months: 12,
  level_source: 'identity_inputs',
};

let evaluations: unknown = [ACCUMULATION_EVALUATION];
let capturedISLRequest: ISLRobustnessRequestV3 | undefined;
const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async callAnalysisEndpoint<T>(_endpoint: string, body: ISLRobustnessRequestV3): Promise<{ data: T }> {
    capturedISLRequest = structuredClone(body);
    return { data: {
      ...makeComputedIslResponse(),
      // A measured band keeps this complete computed response inside the
      // existing published rank_stability enum (which does not admit null).
      factor_sensitivity: [{
        node_id: 'factor-0', sensitivity_score: 0.4, importance_score: 0.4,
        importance_rank: 1, elasticity: 0.4, direction: 'positive',
        attribution_stability: 'high', rank_flip_rate: 0.1,
      }],
      ...(evaluations !== undefined && { identity_evaluations: structuredClone(evaluations) }),
    } as T };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, get islService() { return mockISLService; } };
});

import { createServer } from '../src/createServer.js';

const spec = parse(readFileSync(new URL('../contracts/openapi.yaml', import.meta.url), 'utf8'));

function accumulationRunBody() {
  return {
    ...makeValidRunBody(),
    graph: {
      nodes: [
        { id: 'factor-0', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200 } },
        { id: 'stock_today', kind: 'factor', label: 'Stock today', observed_state: { value: 0.3, raw_value: 1500, cap: 5000 } },
        { id: 'monthly_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.03, raw_value: 3, unit: '%' } },
        { id: 'monthly_inflow', kind: 'factor', label: 'Inflow', observed_state: { value: 0.1, raw_value: 100, cap: 1000 } },
        { id: 'subscribers_at_horizon', kind: 'outcome', label: 'Stock at month 12',
          observed_state: { value: 0, cap: 10000 },
          nonlinear_identity: { operation: 'accumulation',
            factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
            horizon_months: 12, rate_scale: 0.01, stated_in_brief: true } },
        { id: 'goal', kind: 'goal', label: 'MRR', observed_state: { value: 0, cap: 2000000 },
          nonlinear_identity: { operation: 'product', factor_ids: ['factor-0', 'subscribers_at_horizon'], stated_in_brief: true } },
      ],
      edges: [
        ...['stock_today', 'monthly_churn', 'monthly_inflow'].map((from) => ({ from, to: 'subscribers_at_horizon' })),
        ...['factor-0', 'subscribers_at_horizon'].map((from) => ({ from, to: 'goal' })),
      ].map((edge) => ({ ...edge, exists_probability: 1, strength: { mean: 1, std: 0.05 } })),
    },
  };
}

const FRAMED_CHURN_SHAPES = [
  { name: 'value/raw_value pair on 100', observed_state: { value: 0.03, unit: '%', raw_value: 3 }, scale_frame: 100, frameCarrier: 'pair' as const },
  { name: 'value/cap on 20', observed_state: { value: 0.15, unit: '%', cap: 20 }, scale_frame: 20, frameCarrier: 'cap' as const },
];

function churnFacts(node: { observed_state?: unknown; quantity_frame?: unknown; scale_frame?: unknown }) {
  return {
    observed_state: node.observed_state,
    ...(node.quantity_frame !== undefined ? { quantity_frame: node.quantity_frame } : {}),
  };
}

// OpenAPI 3 request schemas use boolean exclusiveMinimum/Maximum. Ajv 8
// accepts JSON Schema's numeric form; preserve the published bound when
// compiling the request-only carrier schema for these contract rows.
function requestSchemaForAjv(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(requestSchemaForAjv);
  if (value === null || typeof value !== 'object') return value;
  const schema = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, requestSchemaForAjv(child)]));
  for (const suffix of ['Minimum', 'Maximum']) {
    const exclusive = `exclusive${suffix}`;
    const inclusive = suffix.toLowerCase();
    if (schema[exclusive] === true) {
      schema[exclusive] = schema[inclusive];
      delete schema[inclusive];
    } else if (schema[exclusive] === false) {
      delete schema[exclusive];
    }
  }
  return schema;
}

describe('accumulation identity wire disclosure and published schemas', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('RATE_LIMIT_ENABLED', '0');
    vi.stubEnv('CEE_ORCHESTRATOR_ENABLED', '0');
    app = await createServer();
    await app.ready();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    evaluations = [ACCUMULATION_EVALUATION];
    capturedISLRequest = undefined;
    admission.__setIslComputeAdmissionForTest({ admission: null, skew: false, status: 'disabled' });
  });
  afterEach(() => { admission.__resetIslComputeAdmission(); });

  async function hashFor(payload: Record<string, unknown>) {
    capturedISLRequest = undefined;
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.analysis_status).toBe('computed');
    expect(body._meta.response_hash).toMatch(/^[a-f0-9]{16}$/);
    expect(capturedISLRequest).toBeDefined();
    return { hash: body._meta.response_hash as string, isl: capturedISLRequest! };
  }

  it.each([
    { name: 'authored spreads', rate_sigma_log: [0.136, 0.246] },
    { name: 'explicit zero spreads', rate_sigma_log: [0, 0] },
    { name: 'absent spreads', rate_sigma_log: undefined },
  ])('rate_sigma_log $name retains exact carrier bytes through normalise, toISLNode and route egress', async ({ rate_sigma_log }) => {
    const payload = accumulationRunBody();
    const input = payload.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!;
    // The level-less derived carrier resolves its frame from node-level scale_frame.
    delete (input as { observed_state?: unknown }).observed_state;
    Object.assign(input, { scale_frame: 10000 });
    if (rate_sigma_log !== undefined) Object.assign(input.nonlinear_identity!, { rate_sigma_log });
    const before = structuredClone(payload);
    const engine = normaliseGraph(payload.graph).graph.nodes.find((node) => node.id === input.id)!;
    const projected = toISLNode(engine);
    const { isl } = await hashFor(payload);
    const wire = isl.graph.nodes.find((node) => node.id === input.id)!;
    for (const [stage, node] of [['normalise', engine], ['toISLNode', projected], ['route egress', wire]] as const) {
      expect.soft(JSON.stringify(node.nonlinear_identity), stage).toBe(JSON.stringify(input.nonlinear_identity));
      if (rate_sigma_log === undefined) expect.soft(node.nonlinear_identity, stage).not.toHaveProperty('rate_sigma_log');
    }
    expect(wire.execution_frame).toEqual({ frame: 10000, carrier: 'scale_frame' });
    expect(JSON.parse(JSON.stringify(wire))).not.toHaveProperty('observed_state');
    if (rate_sigma_log === undefined) {
      // Literal pre-field wire bytes: no sigma key or implicit zero pair.
      expect(JSON.stringify(wire)).toBe(JSON.stringify({
        id: 'subscribers_at_horizon', kind: 'outcome', label: 'Stock at month 12', intercept: 0, epsilon_std: 0,
        nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
          horizon_months: 12, rate_scale: 0.01, stated_in_brief: true },
        execution_frame: { frame: 10000, carrier: 'scale_frame' },
      }));
    }
    expect(payload).toEqual(before);
  });

  it.each([
    ['negative', [-0.1, 0.2]],
    ['one entry', [0.1]],
    ['three entries', [0.1, 0.2, 0.3]],
    // JSON serialises non-finite numbers as null; direct-reader rows cover the originals.
    ['NaN on JSON wire', [NaN, 0.1]],
    ['Infinity on JSON wire', [0.1, Infinity]],
    ['non-array', 'x'],
  ])('returns 422 naming nonlinear_identity.rate_sigma_log for %s before ISL egress', async (_name, rate_sigma_log) => {
    const payload = accumulationRunBody();
    Object.assign(payload.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!.nonlinear_identity!, { rate_sigma_log });
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.body).toContain('nonlinear_identity.rate_sigma_log');
    expect(capturedISLRequest).toBeUndefined();
  });

  it.each(['product', 'sum'])('returns 422 naming rate_sigma_log on a %s before ISL egress', async (operation) => {
    const payload = accumulationRunBody();
    Object.assign(payload.graph.nodes.find((node) => node.id === 'goal')!.nonlinear_identity!, { operation, rate_sigma_log: [0.136, 0.246] });
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.body).toContain('nonlinear_identity.rate_sigma_log');
    expect(capturedISLRequest).toBeUndefined();
    const edited = accumulationRunBody();
    Object.assign(edited.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!.nonlinear_identity!,
      { operation, rate_sigma_log: [0.136, 0.246] });
    const editedResponse = await app.inject({ method: 'POST', url: '/v2/run', payload: edited });
    expect(editedResponse.statusCode, editedResponse.body).toBe(422);
    expect(editedResponse.body).toContain('nonlinear_identity.rate_sigma_log');
    expect(capturedISLRequest).toBeUndefined();
  });

  it.each(FRAMED_CHURN_SHAPES.flatMap((shape) => [false, true].map((withFrames) => ({ ...shape, withFrames }))))(
    'Round 2 (b) keeps framed % churn $name byte-identical at normalization, projection and ISL egress; optional frames=$withFrames',
    async ({ observed_state, scale_frame, frameCarrier, withFrames }) => {
      const payload = accumulationRunBody();
      const input = payload.graph.nodes.find((node) => node.id === 'monthly_churn')!;
      Object.assign(input, { observed_state, ...(withFrames ? { scale_frame, quantity_frame: 'level' } : {}) });
      const before = structuredClone(payload);
      const expected = churnFacts(input);
      const engine = normaliseGraph(payload.graph).graph.nodes.find((node) => node.id === input.id)!;
      const projected = toISLNode(engine);
      const { isl } = await hashFor(payload);
      const wire = isl.graph.nodes.find((node) => node.id === input.id)!;

      for (const [stage, node] of [['normalization', engine], ['toISLNode', projected], ['ISL egress', wire]] as const) {
        // JSON bytes discard absent internal keys, while preserving the producer's exact numeric values and fields.
        expect.soft(JSON.stringify(churnFacts(node)), stage).toBe(JSON.stringify(expected));
        expect.soft(JSON.stringify(node.observed_state), `${stage} observed_state`).toBe(JSON.stringify(observed_state));
      }
      expect(wire.execution_frame).toEqual({ frame: scale_frame,
        carrier: withFrames && frameCarrier === 'pair' ? 'scale_frame' : frameCarrier });
      // ISL restores the user-unit churn level with execution_frame before applying rate_scale.
      // Its NodeV2 declares no scale_frame; PLoT resolves that raw metadata into execution_frame.
      expect(wire).not.toHaveProperty('scale_frame');
      expect(isl.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!.nonlinear_identity)
        .toEqual(payload.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!.nonlinear_identity);
      expect(isl.graph.nodes.find((node) => node.id === 'goal')!.nonlinear_identity)
        .toEqual(payload.graph.nodes.find((node) => node.id === 'goal')!.nonlinear_identity);
      expect(payload).toEqual(before);
    },
  );

  it.each(FRAMED_CHURN_SHAPES)(
    'Round 2 (b) non-participant % control keeps the existing wire behavior for $name',
    async ({ observed_state, scale_frame }) => {
      const payload = accumulationRunBody();
      // Churn remains on the causal path, but no accumulation identity declares it as a participant.
      delete payload.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!.nonlinear_identity;
      const input = payload.graph.nodes.find((node) => node.id === 'monthly_churn')!;
      Object.assign(input, { observed_state, scale_frame, quantity_frame: 'level' });
      const engine = normaliseGraph(payload.graph).graph.nodes.find((node) => node.id === input.id)!;
      const projected = toISLNode(engine);
      const { isl } = await hashFor(payload);
      const wire = isl.graph.nodes.find((node) => node.id === input.id)!;
      const expected = { observed_state, quantity_frame: 'level' };
      for (const node of [engine, projected, wire]) {
        expect(JSON.stringify(churnFacts(node))).toBe(JSON.stringify(expected));
        expect(node).not.toHaveProperty('scale_frame');
      }
      expect(wire).toEqual({ id: 'monthly_churn', kind: 'factor', label: 'Churn',
        observed_state, intercept: 0, epsilon_std: 0, quantity_frame: 'level' });
    },
  );

  it('Round 1 #3 swapping accumulation factor_ids changes the response hash', async () => {
    const original = accumulationRunBody();
    const swapped = structuredClone(original);
    const carrier = swapped.graph.nodes.find((node) => node.id === 'subscribers_at_horizon')!;
    carrier.nonlinear_identity!.factor_ids.reverse();
    const a = await hashFor(original);
    const b = await hashFor(swapped);
    const identityOf = (isl: ISLRobustnessRequestV3) => isl.graph.nodes
      .find((node) => node.id === 'subscribers_at_horizon')!.nonlinear_identity;
    expect(identityOf(a.isl)).toEqual({ operation: 'accumulation',
      factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
      horizon_months: 12, rate_scale: 0.01, stated_in_brief: true });
    expect(identityOf(b.isl)).toEqual({ ...identityOf(a.isl),
      factor_ids: ['monthly_inflow', 'monthly_churn', 'stock_today'] });
    expect(b.hash).not.toBe(a.hash);
  });

  it('Round 1 #3 a same-order accumulation clone has the same response hash', async () => {
    const payload = accumulationRunBody();
    const a = await hashFor(payload);
    const b = await hashFor(structuredClone(payload));
    expect(b.isl.graph).toEqual(a.isl.graph);
    expect(b.hash).toBe(a.hash);
  });

  it.each(['product', 'sum'])('Round 1 #3 swapping %s factor_ids keeps the same response hash', async (operation) => {
    const original = accumulationRunBody();
    const goal = original.graph.nodes.find((node) => node.id === 'goal')!;
    goal.nonlinear_identity!.operation = operation;
    const swapped = structuredClone(original);
    swapped.graph.nodes.find((node) => node.id === 'goal')!.nonlinear_identity!.factor_ids.reverse();
    const a = await hashFor(original);
    const b = await hashFor(swapped);
    expect(a.isl.graph.nodes.find((node) => node.id === 'goal')!.nonlinear_identity)
      .toEqual({ operation, factor_ids: ['factor-0', 'subscribers_at_horizon'], stated_in_brief: true });
    expect(b.isl.graph.nodes.find((node) => node.id === 'goal')!.nonlinear_identity)
      .toEqual({ operation, factor_ids: ['subscribers_at_horizon', 'factor-0'], stated_in_brief: true });
    expect(b.hash).toBe(a.hash);
  });

  it('T5 forwards the exact ISL accumulation evaluation, including horizon_months, in an Ajv-valid 200 response', async () => {
    const response = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.analysis_status).toBe('computed');
    expect(body.identity_evaluations).toStrictEqual([ACCUMULATION_EVALUATION]);
    const schema = spec.paths['/v2/run'].post.responses['200'].content['application/json'].schema;
    const validate = new Ajv({ strict: false, validateFormats: false }).compile({ ...schema, components: spec.components });
    expect(validate(body), JSON.stringify(validate.errors)).toBe(true);

    // The optional disclosure remains absent when the ISL wire omits it.
    evaluations = undefined;
    const ordinary = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(ordinary.json()).not.toHaveProperty('identity_evaluations');
    expect(validate(ordinary.json()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('T5 the response evaluation schema admits an absent horizon and rejects out-of-contract disclosed horizons', () => {
    const schema = spec.components.schemas.runResponseV3.properties.identity_evaluations.items;
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema);
    expect(validate(ACCUMULATION_EVALUATION), JSON.stringify(validate.errors)).toBe(true);
    const { horizon_months: _horizon, ...withoutHorizon } = ACCUMULATION_EVALUATION;
    expect(validate(withoutHorizon), JSON.stringify(validate.errors)).toBe(true);
    // Match ISL's optional-null schema; its live exclude_none wire omits nulls.
    expect(validate({ ...ACCUMULATION_EVALUATION, horizon_months: null }), JSON.stringify(validate.errors)).toBe(true);
    for (const horizon_months of [0, 121, 12.5, '12']) {
      expect(validate({ ...ACCUMULATION_EVALUATION, horizon_months }), String(horizon_months)).toBe(false);
      expect(validate.errors?.some((error) => error.instancePath === '/horizon_months')).toBe(true);
    }
  });

  it('the published request carrier accepts only the positional accumulation contract', () => {
    const schema = spec.components.schemas.nodeV3.properties.nonlinear_identity;
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(requestSchemaForAjv(schema) as object);
    const carrier = {
      operation: 'accumulation',
      factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
      horizon_months: 12, rate_scale: 0.01, stated_in_brief: false,
    };
    expect(validate(carrier), JSON.stringify(validate.errors)).toBe(true);
    for (const malformed of [
      { factor_ids: ['stock_today', 'monthly_churn'] },
      { factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow', 'fourth'] },
      { factor_ids: ['stock_today', 'monthly_churn', 'stock_today'] },
      { factor_ids: ['stock_today', '', 'monthly_inflow'] },
      ...[0, 121, 12.5, '12'].map((horizon_months) => ({ horizon_months })),
      ...[0, 1.5, NaN, -0.01].map((rate_scale) => ({ rate_scale })),
      { addends: ['extra'] }, { reading_licence: {} }, { unknown_key: true },
    ]) {
      expect(validate({ ...carrier, ...malformed }), JSON.stringify(malformed)).toBe(false);
    }
    for (const rate_scale of [0.01, 1]) {
      expect(validate({ ...carrier, rate_scale }), JSON.stringify(validate.errors)).toBe(true);
    }
    for (const operation of ['product', 'sum']) {
      const ordinary = { operation, factor_ids: ['price', 'stock'], stated_in_brief: false };
      expect(validate(ordinary), JSON.stringify(validate.errors)).toBe(true);
      expect(validate({ ...ordinary, horizon_months: 12 }), operation).toBe(false);
      expect(validate({ ...ordinary, rate_scale: 0.01 }), operation).toBe(false);
    }
  });
});
