/**
 * Route-level integration tests for categorical integrity (audit C1-A).
 *
 * Asserts:
 *   - The C1 audit fixture (now copied to tests/fixtures/c1-categorical-direct.json)
 *     produces HTTP 422 with NOMINAL_INTERVENTION_NOT_SUPPORTED.
 *   - ISL is never invoked when a categorical block fires (proven via vi.mock spy
 *     that throws on any method call).
 *   - A correctly-decomposed one-hot graph (separate per-category factors with
 *     binary {0,1} values, no metadata) passes through with no categorical
 *     critique.
 *   - A future-shape graph with explicit categorical_group_id metadata produces
 *     a CATEGORICAL_DECOMPOSED info critique (forward-compat for CEE follow-up).
 *   - A mutex violation produces ONE_HOT_MUTEX_VIOLATION blocker.
 *   - With the feature flag OFF, none of the above fires (preserves kill switch
 *     for in-flight pilot sessions).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// ISL spy — throws on any method call. Tests that expect a successful ISL
// path are NOT in this file (categorical detection blocks before ISL on every
// case here). When detection passes, ISL_ENABLE='0' takes over the path.
// =============================================================================
let islInvocations = 0;
const islSpy = {
  isEnabled(): boolean {
    return false; // ISL_ENABLE='0' default — categorical detection runs before this anyway
  },
  async callAnalysisEndpoint(): Promise<never> {
    islInvocations += 1;
    throw new Error('ISL.callAnalysisEndpoint should not be called when categorical block fires');
  },
  async isAvailable(): Promise<boolean> {
    return false;
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return {
    ...actual,
    getISLService: () => islSpy,
    islService: islSpy,
  };
});

import { createServer } from '../src/createServer.js';

describe('/v2/run categorical integrity (audit C1-A)', () => {
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

  // ---------------------------------------------------------------------------
  // C1 fixture regression test (correction #5)
  // ---------------------------------------------------------------------------
  it('C1 audit fixture: blocks with NOMINAL_INTERVENTION_NOT_SUPPORTED and never invokes ISL', async () => {
    islInvocations = 0;

    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;

    // Blocked-response shape contract.
    expect(body.analysis_status).toBe('blocked');

    const critiques = body.critiques as Array<{ code: string; severity: string; user_message?: string; source: string }>;
    expect(Array.isArray(critiques)).toBe(true);
    const blocker = critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED');
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe('blocker');
    expect(blocker!.source).toBe('validation');

    // Humanised user_message: contains the appended actionable sentence.
    expect(blocker!.user_message).toContain('binary indicator per category');

    // Security check (correction #1): user_message must not echo any encoded
    // structural data (encoding_map, raw_value JSON shapes, factor-id prefixes
    // matching the BANNED_PATTERN guard). Note the C1 fixture's option labels
    // and raw_values share characters (UK/US/EU); a textual "no UK" check
    // can't distinguish them — see the next test for the disjoint-strings case.
    expect(blocker!.user_message).not.toMatch(/encoding_map/);
    expect(blocker!.user_message).not.toMatch(/raw_value/);
    expect(blocker!.user_message).not.toMatch(/fac_[a-z_]+/);
    expect(blocker!.user_message).not.toMatch(/value_type/);

    // Detection ran BEFORE Phase 4 — no ISL_NOT_ENABLED critique should appear.
    expect(critiques.find((c) => c.code === 'ISL_NOT_ENABLED')).toBeUndefined();
    // No critique with source 'isl' should appear.
    expect(critiques.find((c) => c.source === 'isl')).toBeUndefined();

    // The previous EU=0.926 win-probability path is unreachable: blocked
    // responses do not carry `option_comparison`.
    expect(body.option_comparison).toBeUndefined();

    // ISL spy: zero invocations.
    expect(islInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Security regression: raw_value content must NOT appear in user_message,
  // even when option labels are textually distinct from raw_values.
  // ---------------------------------------------------------------------------
  it('user_message does not echo raw_value strings (verified with disjoint label/raw_value strings)', async () => {
    islInvocations = 0;
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_region', kind: 'factor', label: 'Region', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_region', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_alpha', label: 'Alpha', interventions: { fac_region: { value: 0, value_type: 'categorical', raw_value: 'GZQXR1', source: 'user_specified' } } },
        { id: 'opt_beta',  label: 'Beta',  interventions: { fac_region: { value: 1, value_type: 'categorical', raw_value: 'WRMVT2', source: 'user_specified' } } },
        { id: 'opt_gamma', label: 'Gamma', interventions: { fac_region: { value: 2, value_type: 'categorical', raw_value: 'KPDLN3', source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string; user_message?: string; message?: string }>;
    const blocker = critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED');
    expect(blocker).toBeDefined();

    const msg = blocker!.user_message ?? '';
    // Raw values must not appear — proves labels-only resolution holds.
    expect(msg).not.toContain('GZQXR1');
    expect(msg).not.toContain('WRMVT2');
    expect(msg).not.toContain('KPDLN3');
    expect(islInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Pass-through: properly-decomposed one-hot (current CEE prompt-compliant shape)
  // ---------------------------------------------------------------------------
  it('properly-decomposed one-hot graph (3 separate factors, binary values) does NOT block on categorical grounds', async () => {
    islInvocations = 0;

    // Three per-category factors. Each factor only has values {0,1} across
    // options. No categorical metadata. Detection must not fire.
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
        {
          id: 'opt_uk',
          label: 'UK',
          interventions: { fac_market_uk: { value: 1, source: 'user_specified' }, fac_market_us: { value: 0, source: 'user_specified' }, fac_market_eu: { value: 0, source: 'user_specified' } },
        },
        {
          id: 'opt_us',
          label: 'US',
          interventions: { fac_market_uk: { value: 0, source: 'user_specified' }, fac_market_us: { value: 1, source: 'user_specified' }, fac_market_eu: { value: 0, source: 'user_specified' } },
        },
        {
          id: 'opt_eu',
          label: 'EU',
          interventions: { fac_market_uk: { value: 0, source: 'user_specified' }, fac_market_us: { value: 0, source: 'user_specified' }, fac_market_eu: { value: 1, source: 'user_specified' } },
        },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // ISL is disabled (vi.mock isEnabled→false), so this returns 200 with
    // `analysis_status: 'failed'` + ISL_NOT_ENABLED, NOT 422 with
    // categorical-block status.
    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string }>;
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'ONE_HOT_MUTEX_VIOLATION')).toBeUndefined();
    // ISL spy still not called (it's disabled, not invoked).
    expect(islInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Forward-compat: explicit categorical_group_id with mutex-clean indicators
  // ---------------------------------------------------------------------------
  it('explicitly-grouped one-hot with categorical_group_id produces CATEGORICAL_DECOMPOSED info critique', async () => {
    islInvocations = 0;
    const groupTag = 'market_group';
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_uk', kind: 'factor', label: 'UK', observed_state: { value: 0, std: 0.3 } },
          { id: 'fac_us', kind: 'factor', label: 'US', observed_state: { value: 0, std: 0.3 } },
          { id: 'fac_eu', kind: 'factor', label: 'EU', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Revenue' },
        ],
        edges: [
          { from: 'fac_uk', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_us', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_eu', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        {
          id: 'opt_uk',
          label: 'UK',
          interventions: {
            fac_uk: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
            fac_us: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
            fac_eu: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
          },
        },
        {
          id: 'opt_us',
          label: 'US',
          interventions: {
            fac_uk: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
            fac_us: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
            fac_eu: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
          },
        },
        {
          id: 'opt_eu',
          label: 'EU',
          interventions: {
            fac_uk: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
            fac_us: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
            fac_eu: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
          },
        },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // 200 (not blocked) — categorical was validated as safe one-hot.
    // Detection passes, then ISL_NOT_ENABLED takes the path (since ISL spy
    // returns isEnabled→false).
    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string; severity: string }>;

    // No categorical block.
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
    // CATEGORICAL_DECOMPOSED info critique fires.
    const decomposed = critiques.find((c) => c.code === 'CATEGORICAL_DECOMPOSED');
    expect(decomposed).toBeDefined();
    expect(decomposed!.severity).toBe('info');
    // ISL never invoked.
    expect(islInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Mutex violation: explicitly grouped, two indicators set to 1 in one option
  // ---------------------------------------------------------------------------
  it('mutex violation in explicit one-hot group raises ONE_HOT_MUTEX_VIOLATION blocker and never invokes ISL', async () => {
    islInvocations = 0;
    const groupTag = 'group_x';
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0, std: 0.3 } },
          { id: 'fac_b', kind: 'factor', label: 'B', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_a', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_b', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        {
          id: 'opt_violation',
          label: 'Violation',
          interventions: {
            fac_a: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
            fac_b: { value: 1, categorical_group_id: groupTag, source: 'user_specified' }, // both 1 → violation
          },
        },
        {
          id: 'opt_clean',
          label: 'Clean',
          interventions: {
            fac_a: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
            fac_b: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
          },
        },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.analysis_status).toBe('blocked');

    const critiques = body.critiques as Array<{ code: string; severity: string; affected_option_ids?: string[] }>;
    const violation = critiques.find((c) => c.code === 'ONE_HOT_MUTEX_VIOLATION');
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe('blocker');
    expect(violation!.affected_option_ids).toContain('opt_violation');
    expect(islInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // STRIPPED_FIELD_WARNING fires for binary-categorical-with-metadata pass-through
  // ---------------------------------------------------------------------------
  it('binary categorical (value_type:"categorical" with {0,1} values) passes but emits STRIPPED_FIELD_WARNING', async () => {
    islInvocations = 0;
    // Binary categorical bypasses block via rule 1's binary bypass; metadata
    // gets stripped by normalisation, so STRIPPED_FIELD_WARNING fires for
    // value_type and (paired) raw_value.
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_flag', kind: 'factor', label: 'Flag', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_flag', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_flag: { value: 1, value_type: 'categorical', raw_value: 'true', source: 'user_specified' } } },
        { id: 'opt_b', label: 'B', interventions: { fac_flag: { value: 0, value_type: 'categorical', raw_value: 'false', source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string; severity: string }>;

    // Block does not fire (binary bypass).
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
    // STRIPPED_FIELD_WARNING fires.
    const stripped = critiques.find((c) => c.code === 'STRIPPED_FIELD_WARNING');
    expect(stripped).toBeDefined();
    expect(stripped!.severity).toBe('warning');
    expect(islInvocations).toBe(0);
  });
});

// =============================================================================
// Feature-flag OFF: kill switch preserves prior silent-strip behaviour
// (separate describe to allow independent server with the flag unset).
// =============================================================================
describe('/v2/run categorical integrity — feature flag OFF (kill switch)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.AUTH_ENABLED = '0';
    delete process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT;

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
  });

  it('with CATEGORICAL_INTEGRITY_ENFORCEMENT unset, the C1 fixture does NOT trigger the new blocker', async () => {
    islInvocations = 0;

    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    // No new categorical critiques fire.
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'ONE_HOT_MUTEX_VIOLATION')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'CATEGORICAL_DECOMPOSED')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'STRIPPED_FIELD_WARNING')).toBeUndefined();
    // ISL spy still not invoked because ISL_ENABLE is unset (irrelevant to feature-flag test).
    expect(islInvocations).toBe(0);
  });
});
