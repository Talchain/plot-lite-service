/**
 * Migration safety regression tests for the C1-A categorical-integrity fix.
 *
 * Asserts that the conservative-block design does NOT regress legitimate
 * existing flows. Each fixture below mirrors a known-good pattern from the
 * audit + the existing test suite:
 *
 *   - Binary 0/1 numeric factor (D-section: hiring scenario shape)
 *   - Currency factor with raw_value display string (D3 hiring scenario)
 *   - Ratio factor with state_space.range > 1.0 (D4 NRR scenario)
 *   - Numeric continuous (smooth values)
 *   - Per-category one-hot (3 separate factors with binary values, no metadata)
 *
 * All must pass through detection without raising any new categorical critique.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  // ISL stays disabled — every test below should pass detection without
  // surfacing new categorical critiques. The test does not care about ISL
  // output; it only cares about the categorical layer.
  return {
    ...actual,
    getISLService: () => ({ isEnabled: () => false, isAvailable: async () => false }),
  };
});

import { createServer } from '../src/createServer.js';

describe('Categorical migration safety — no regressions on existing flows', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT = '1';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.AUTH_ENABLED;
    delete process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT;
  });

  function noNewCategoricalCritiques(critiques: Array<{ code: string }>): void {
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'ONE_HOT_MUTEX_VIOLATION')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'STRIPPED_FIELD_WARNING')).toBeUndefined();
    // CATEGORICAL_DECOMPOSED is informational and ONLY fires for an explicit
    // group_id (which none of these fixtures provide); assert it's absent too.
    expect(critiques.find((c) => c.code === 'CATEGORICAL_DECOMPOSED')).toBeUndefined();
  }

  it('binary 0/1 numeric factor passes unchanged', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_hire', kind: 'factor', label: 'Tech lead hired', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Velocity gain' },
        ],
        edges: [
          { from: 'fac_hire', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_hire', label: 'Hire', interventions: { fac_hire: { value: 1, source: 'user_specified' } } },
        { id: 'opt_no_hire', label: 'No hire', interventions: { fac_hire: { value: 0, source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    noNewCategoricalCritiques(critiques);
  });

  it('currency factor with raw_value display string passes unchanged (no STRIPPED_FIELD_WARNING)', async () => {
    // raw_value alone (no value_type:"categorical", no encoding_map) is
    // display-only metadata — must not trigger STRIPPED_FIELD_WARNING per
    // correction #3.
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_salary', kind: 'factor', label: 'Salary', observed_state: { value: 180000, std: 30000, cap: 300000 } },
          { id: 'outcome', kind: 'outcome', label: 'Velocity' },
        ],
        edges: [
          { from: 'fac_salary', to: 'outcome', exists_probability: 0.8, strength: { mean: 0.5, std: 0.15 } },
        ],
      },
      options: [
        { id: 'opt_high', label: 'High £', interventions: { fac_salary: { value: 180000, raw_value: '£180,000', source: 'user_specified' } } },
        { id: 'opt_low', label: 'Low £', interventions: { fac_salary: { value: 0, raw_value: '£0', source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    noNewCategoricalCritiques(critiques);
  });

  it('NRR-like ratio (>1.0) with explicit state_space.range passes unchanged', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_nrr', kind: 'factor', label: 'NRR', observed_state: { value: 1.15, std: 0.1 }, state_space: { range: { min: 0.7, max: 1.5 } } },
          { id: 'outcome', kind: 'outcome', label: 'Annual revenue' },
        ],
        edges: [
          { from: 'fac_nrr', to: 'outcome', exists_probability: 0.95, strength: { mean: 0.8, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_high', label: 'High NRR', interventions: { fac_nrr: { value: 1.20, source: 'user_specified' } } },
        { id: 'opt_low', label: 'Low NRR', interventions: { fac_nrr: { value: 0.95, source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    noNewCategoricalCritiques(critiques);
  });

  it('numeric continuous (smooth values) passes unchanged', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 1.5, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_x', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_x: { value: 1.5, source: 'user_specified' } } },
        { id: 'opt_b', label: 'B', interventions: { fac_x: { value: 2.7, source: 'user_specified' } } },
        { id: 'opt_c', label: 'C', interventions: { fac_x: { value: 3.1, source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    noNewCategoricalCritiques(critiques);
  });

  it('per-category one-hot factors (3 factors, binary {0,1} values, no metadata) pass unchanged', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_market_uk', kind: 'factor', label: 'Market UK', observed_state: { value: 0, std: 0.3 } },
          { id: 'fac_market_us', kind: 'factor', label: 'Market US', observed_state: { value: 0, std: 0.3 } },
          { id: 'fac_market_eu', kind: 'factor', label: 'Market EU', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Revenue' },
        ],
        edges: [
          { from: 'fac_market_uk', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_market_us', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_market_eu', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_uk', label: 'UK', interventions: { fac_market_uk: { value: 1, source: 'user_specified' }, fac_market_us: { value: 0, source: 'user_specified' }, fac_market_eu: { value: 0, source: 'user_specified' } } },
        { id: 'opt_us', label: 'US', interventions: { fac_market_uk: { value: 0, source: 'user_specified' }, fac_market_us: { value: 1, source: 'user_specified' }, fac_market_eu: { value: 0, source: 'user_specified' } } },
        { id: 'opt_eu', label: 'EU', interventions: { fac_market_uk: { value: 0, source: 'user_specified' }, fac_market_us: { value: 0, source: 'user_specified' }, fac_market_eu: { value: 1, source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    noNewCategoricalCritiques(critiques);
  });

  it('mixed numeric graph (multiple factors, no categorical metadata) passes unchanged', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0.5, std: 0.1 } },
          { id: 'fac_b', kind: 'factor', label: 'B', observed_state: { value: 0.3, std: 0.08 } },
          { id: 'fac_c', kind: 'factor', label: 'C', observed_state: { value: 0.7, std: 0.15 } },
          { id: 'fac_d', kind: 'factor', label: 'D', observed_state: { value: 0.4, std: 0.12 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_a', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
          { from: 'fac_b', to: 'outcome', exists_probability: 0.85, strength: { mean: 0.4, std: 0.08 } },
          { from: 'fac_c', to: 'outcome', exists_probability: 0.95, strength: { mean: 0.7, std: 0.12 } },
          { from: 'fac_d', to: 'outcome', exists_probability: 0.8, strength: { mean: 0.5, std: 0.15 } },
        ],
      },
      options: [
        { id: 'opt_high', label: 'High', interventions: { fac_a: { value: 0.9, source: 'user_specified' } } },
        { id: 'opt_low', label: 'Low', interventions: { fac_a: { value: 0.1, source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    noNewCategoricalCritiques(critiques);
  });
});
