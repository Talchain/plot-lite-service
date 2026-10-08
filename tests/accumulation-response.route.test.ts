import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv from 'ajv';
import * as admission from '../src/integrations/isl/compute-admission.js';
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
const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async callAnalysisEndpoint<T>(): Promise<{ data: T }> {
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
    admission.__setIslComputeAdmissionForTest({ admission: null, skew: false, status: 'disabled' });
  });
  afterEach(() => { admission.__resetIslComputeAdmission(); });

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
