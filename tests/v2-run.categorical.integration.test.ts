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
// ISL spy. Two counters:
//   - `islCallEndpointInvocations`: counts only `callAnalysisEndpoint` calls
//     (the actual ISL-side analysis). Success-path tests in this file expect
//     this to be 0 because the route exits via ISL_NOT_ENABLED (the spy
//     reports isEnabled=false, by design).
//   - `islMethodTouches`: counts EVERY method call on the spy. Blocker-path
//     tests assert this is 0 — the request must return 422 before any ISL
//     client method is touched.
// Both counters reset at the start of each test.
// =============================================================================
let islCallEndpointInvocations = 0;
let islMethodTouches = 0;
const islSpy = {
  isEnabled(): boolean {
    islMethodTouches += 1;
    return false; // categorical detection should run before this anyway
  },
  async callAnalysisEndpoint(): Promise<never> {
    islCallEndpointInvocations += 1;
    islMethodTouches += 1;
    throw new Error('ISL.callAnalysisEndpoint should not be called when categorical block fires');
  },
  async isAvailable(): Promise<boolean> {
    islMethodTouches += 1;
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
    // Detection is enabled by default (fail-closed). Explicitly setting `=1`
    // is equivalent here; the explicit set documents intent within the test.
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
    islCallEndpointInvocations = 0; islMethodTouches = 0;

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

    // Humanised user_message: factor-framed reframe copy.
    expect(blocker!.user_message).toContain('binary factor per category');
    expect(blocker!.user_message!.toLowerCase()).toContain('unordered categor');
    // Must not front the option label as if it were the factor.
    expect(blocker!.user_message).not.toMatch(/^UK |^US |^EU /);

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

    // ISL spy: zero invocations on ANY method — the request must return 422
    // before the route ever touches the ISL client.
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Security regression: raw_value content must NOT appear in user_message,
  // even when option labels are textually distinct from raw_values.
  // ---------------------------------------------------------------------------
  it('user_message does not echo raw_value strings (verified with disjoint label/raw_value strings)', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
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
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Pass-through: properly-decomposed one-hot (current CEE prompt-compliant shape)
  // ---------------------------------------------------------------------------
  it('properly-decomposed one-hot graph (3 separate factors, binary values) does NOT block on categorical grounds', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;

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
    expect(islCallEndpointInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Forward-compat: explicit categorical_group_id with mutex-clean indicators
  // ---------------------------------------------------------------------------
  it('explicitly-grouped one-hot with categorical_group_id produces CATEGORICAL_DECOMPOSED info critique', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
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
    expect(islCallEndpointInvocations).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Mutex violation: explicitly grouped, two indicators set to 1 in one option
  // ---------------------------------------------------------------------------
  it('mutex violation in explicit one-hot group raises ONE_HOT_MUTEX_VIOLATION blocker and never invokes ISL', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
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
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // ONE_HOT_GROUPING_INCONSISTENT: conflicting group_id across options blocks
  // ---------------------------------------------------------------------------
  it('conflicting categorical_group_id across options raises ONE_HOT_GROUPING_INCONSISTENT and never invokes ISL', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_x', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_x: { value: 1, categorical_group_id: 'group_one', source: 'user_specified' } } },
        { id: 'opt_b', label: 'B', interventions: { fac_x: { value: 1, categorical_group_id: 'group_two', source: 'user_specified' } } },
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

    const critiques = body.critiques as Array<{ code: string; severity: string; user_message?: string; message?: string }>;
    const inconsistency = critiques.find((c) => c.code === 'ONE_HOT_GROUPING_INCONSISTENT');
    expect(inconsistency).toBeDefined();
    expect(inconsistency!.severity).toBe('blocker');

    // Sanitised message: must not echo the user-supplied group IDs.
    expect(inconsistency!.message).not.toContain('group_one');
    expect(inconsistency!.message).not.toContain('group_two');
    expect(inconsistency!.user_message).not.toContain('group_one');
    expect(inconsistency!.user_message).not.toContain('group_two');

    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // ONE_HOT_GROUPING_INCONSISTENT: partial group_id coverage blocks
  // ---------------------------------------------------------------------------
  it('partial categorical_group_id coverage (some options omit) raises ONE_HOT_GROUPING_INCONSISTENT', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_x', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_x: { value: 1, categorical_group_id: 'group_one', source: 'user_specified' } } },
        { id: 'opt_b', label: 'B', interventions: { fac_x: { value: 0, source: 'user_specified' } } }, // no group_id
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
    const critiques = body.critiques as Array<{ code: string; severity: string }>;
    expect(critiques.find((c) => c.code === 'ONE_HOT_GROUPING_INCONSISTENT')).toBeDefined();
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // ONE_HOT_MUTEX_VIOLATION: missing indicator in option blocks
  // ---------------------------------------------------------------------------
  it('missing indicator in one option of an explicitly grouped one-hot raises ONE_HOT_MUTEX_VIOLATION', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
    const groupTag = 'g_market';
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_uk', kind: 'factor', label: 'UK', observed_state: { value: 0, std: 0.3 } },
          { id: 'fac_us', kind: 'factor', label: 'US', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_uk', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
          { from: 'fac_us', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_complete', label: 'Complete', interventions: {
          fac_uk: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
          fac_us: { value: 0, categorical_group_id: groupTag, source: 'user_specified' },
        } },
        { id: 'opt_incomplete', label: 'Incomplete', interventions: {
          fac_uk: { value: 1, categorical_group_id: groupTag, source: 'user_specified' },
          // fac_us missing — must violate
        } },
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
    const critiques = body.critiques as Array<{ code: string; affected_option_ids?: string[] }>;
    const violation = critiques.find((c) => c.code === 'ONE_HOT_MUTEX_VIOLATION');
    expect(violation).toBeDefined();
    expect(violation!.affected_option_ids).toContain('opt_incomplete');
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // type:"nominal" and categories field block (forward-compat detection rule 5)
  // ---------------------------------------------------------------------------
  it('type:"nominal" with multiple distinct values raises NOMINAL_INTERVENTION_NOT_SUPPORTED', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_x', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_x: { value: 0, type: 'nominal', source: 'user_specified' } } },
        { id: 'opt_b', label: 'B', interventions: { fac_x: { value: 1, type: 'nominal', source: 'user_specified' } } },
        { id: 'opt_c', label: 'C', interventions: { fac_x: { value: 2, type: 'nominal', source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string }>;
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeDefined();
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  it('non-empty categories[] field raises NOMINAL_INTERVENTION_NOT_SUPPORTED', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_colour', kind: 'factor', label: 'Colour', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'goal', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_colour', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_red', label: 'Red', interventions: { fac_colour: { value: 0, categories: ['red', 'green', 'blue'], source: 'user_specified' } } },
        { id: 'opt_green', label: 'Green', interventions: { fac_colour: { value: 1, categories: ['red', 'green', 'blue'], source: 'user_specified' } } },
        { id: 'opt_blue', label: 'Blue', interventions: { fac_colour: { value: 2, categories: ['red', 'green', 'blue'], source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string; user_message?: string }>;
    const blocker = critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED');
    expect(blocker).toBeDefined();
    // Security: category values must not echo into user-facing copy.
    // Word-boundary check — substrings inside unrelated words (e.g. "red"
    // inside "unordered") are coincidental and not a security issue. The
    // intent is "user-supplied category values must not appear as
    // standalone words".
    expect(blocker!.user_message).not.toMatch(/\bred\b/i);
    expect(blocker!.user_message).not.toMatch(/\bgreen\b/i);
    expect(blocker!.user_message).not.toMatch(/\bblue\b/i);
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Telemetry — `categorical_integrity_detection` log shape and silent-on-clean
  // ---------------------------------------------------------------------------
  // Strategy: monkey-patch `app.log.child` to wrap every per-request child
  // logger with an `info` shim that records calls to a buffer. Reliable
  // across pino's destination internals (sonic-boom may bypass
  // process.stdout.write).
  type CapturedRecord = Record<string, unknown>;
  const capturedLogs: CapturedRecord[] = [];

  beforeAll(() => {
    const log = (app as unknown as { log: { child: (...args: unknown[]) => unknown } }).log;
    const originalChild = log.child.bind(log);
    log.child = (...args: unknown[]) => {
      const child = originalChild(...args) as { info: (...args: unknown[]) => void };
      const originalInfo = child.info.bind(child);
      child.info = (...infoArgs: unknown[]): void => {
        if (infoArgs[0] && typeof infoArgs[0] === 'object') {
          capturedLogs.push(infoArgs[0] as CapturedRecord);
        }
        return originalInfo(...infoArgs);
      };
      return child;
    };
  });

  function findTelemetryLog(): CapturedRecord | undefined {
    return capturedLogs.find((r) => r.event === 'categorical_integrity_detection');
  }

  function clearCapturedLogs(): void {
    capturedLogs.length = 0;
  }

  it('telemetry: blocker request emits one categorical_integrity_detection log with severity buckets and no PII', async () => {
    clearCapturedLogs();
    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const telemetry = findTelemetryLog();
    expect(telemetry).toBeDefined();
    expect(telemetry!.outcome).toBe('blocked');
    expect(telemetry!.blocker_count).toBe(1);
    expect(telemetry!.warning_count).toBe(0);
    expect(telemetry!.info_count).toBe(0);
    expect(telemetry!.blocked_factor_count).toBe(1);
    expect(telemetry!.option_count).toBe(3);
    expect(telemetry!.triggers).toEqual(['value_type_categorical']);

    // PII check: the C1 fixture has factor "fac_market" + raw_values
    // ["UK","US","EU"] + option labels. Telemetry must NOT contain any of
    // these — only structural counts and internal enum values.
    const serialised = JSON.stringify(telemetry);
    expect(serialised).not.toContain('fac_market');
    expect(serialised).not.toContain('opt_uk');
    expect(serialised).not.toContain('opt_us');
    expect(serialised).not.toContain('opt_eu');
    // The raw_values "UK"/"US"/"EU" must not appear as JSON-quoted strings.
    expect(serialised).not.toContain('"UK"');
    expect(serialised).not.toContain('"US"');
    expect(serialised).not.toContain('"EU"');
  });

  it('telemetry: clean numeric/binary request emits NO categorical_integrity_detection log', async () => {
    clearCapturedLogs();
    // Pure binary 0/1 graph — no categorical metadata. Detection runs
    // (enforcement enabled) but produces zero signals → no telemetry log.
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_hire', kind: 'factor', label: 'Hire', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'outcome', label: 'Outcome' },
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

    await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const telemetry = findTelemetryLog();
    expect(telemetry).toBeUndefined();
  });

  it('telemetry: warning-only request (binary categorical bypass) emits log with warning bucket populated', async () => {
    clearCapturedLogs();
    // Binary value_type:"categorical" with {0,1} bypasses block but should
    // emit STRIPPED_FIELD_WARNING (warning) → telemetry fires.
    const payload = {
      graph: {
        nodes: [
          { id: 'fac_flag', kind: 'factor', label: 'Flag', observed_state: { value: 0, std: 0.3 } },
          { id: 'outcome', kind: 'outcome', label: 'Outcome' },
        ],
        edges: [
          { from: 'fac_flag', to: 'outcome', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
        ],
      },
      options: [
        { id: 'opt_a', label: 'A', interventions: { fac_flag: { value: 1, value_type: 'categorical', source: 'user_specified' } } },
        { id: 'opt_b', label: 'B', interventions: { fac_flag: { value: 0, value_type: 'categorical', source: 'user_specified' } } },
      ],
      goal_node_id: 'outcome',
      seed: 42,
    };

    await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const telemetry = findTelemetryLog();
    expect(telemetry).toBeDefined();
    expect(telemetry!.outcome).toBe('passed_with_signal');
    expect(telemetry!.blocker_count).toBe(0);
    expect(telemetry!.warning_count).toBeGreaterThanOrEqual(1);
    expect(telemetry!.stripped_fields).toContain('value_type');
  });

  // ---------------------------------------------------------------------------
  // STRIPPED_FIELD_WARNING fires for binary-categorical-with-metadata pass-through
  // ---------------------------------------------------------------------------
  it('binary categorical (value_type:"categorical" with {0,1} values) passes but emits STRIPPED_FIELD_WARNING', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;
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
    expect(islCallEndpointInvocations).toBe(0);
  });
});

// =============================================================================
// Default-enabled (fail-closed): with CATEGORICAL_INTEGRITY_ENFORCEMENT unset,
// detection MUST run. This is the audit C1-A fix's shipping default — the
// previous off-by-default rollout would have made the fix a dark feature.
// =============================================================================
describe('/v2/run categorical integrity — default-enabled when env unset (fail-closed)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.AUTH_ENABLED = '0';
    // Deliberately NOT set — default-enabled semantics under test.
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

  it('with CATEGORICAL_INTEGRITY_ENFORCEMENT unset, the C1 fixture STILL blocks (audit C1-A fix is the shipping default)', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;

    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    expect(body.analysis_status).toBe('blocked');
    const critiques = body.critiques as Array<{ code: string; severity: string }>;
    const blocker = critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED');
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe('blocker');
    expect(islCallEndpointInvocations).toBe(0);
    expect(islMethodTouches).toBe(0);
  });
});

// =============================================================================
// Kill switch: explicit `=0` value disables enforcement. Operations escape
// hatch — if the new blocker fires unexpectedly on real pilot traffic, ops
// can flip to `=0` without rolling back the deployment.
// =============================================================================
describe('/v2/run categorical integrity — kill switch (CATEGORICAL_INTEGRITY_ENFORCEMENT=0)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT = '0';

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

  it('with CATEGORICAL_INTEGRITY_ENFORCEMENT=0, no new categorical critiques fire (kill switch)', async () => {
    islCallEndpointInvocations = 0; islMethodTouches = 0;

    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    // None of the new categorical critiques fire — the kill switch preserves
    // the prior (audit-flagged-but-currently-shipped) silent-strip behaviour.
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'ONE_HOT_MUTEX_VIOLATION')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'ONE_HOT_GROUPING_INCONSISTENT')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'CATEGORICAL_DECOMPOSED')).toBeUndefined();
    expect(critiques.find((c) => c.code === 'STRIPPED_FIELD_WARNING')).toBeUndefined();
  });
});

// =============================================================================
// Kill-switch ergonomics: the disable signal accepts multiple operationally
// common values (case-insensitive). Typos (e.g. `=fasle`) fall through to
// default-enabled, preserving fail-closed semantics.
// =============================================================================
describe.each([
  { label: '=false', value: 'false' },
  { label: '=off', value: 'off' },
  { label: '=disabled', value: 'disabled' },
  { label: '=NO (uppercase)', value: 'NO' },
  { label: '=False (mixed-case)', value: 'False' },
])('/v2/run categorical integrity — kill switch alias $label', ({ value }) => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT = value;

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

  it('disables enforcement (no new categorical critiques on the C1 fixture)', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json() as Record<string, unknown>;
    const critiques = (body.critiques as Array<{ code: string }> | undefined) ?? [];
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeUndefined();
  });
});

// =============================================================================
// Typo defaults to enabled (fail-closed for unrecognised values).
// =============================================================================
describe('/v2/run categorical integrity — typo in disable value defaults to ENABLED (fail-closed)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.AUTH_ENABLED = '0';
    // 'fasle' is an unrecognised value (typo of 'false') — must fall through
    // to default-enabled, NOT silently disable. Any operator typo produces
    // safe behaviour.
    process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT = 'fasle';

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

  it('typo "fasle" still blocks the C1 fixture (unrecognised value defaults to enabled)', async () => {
    const fixturePath = join(__dirname, 'fixtures', 'c1-categorical-direct.json');
    const payload = JSON.parse(readFileSync(fixturePath, 'utf-8'));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as Record<string, unknown>;
    const critiques = body.critiques as Array<{ code: string }>;
    expect(critiques.find((c) => c.code === 'NOMINAL_INTERVENTION_NOT_SUPPORTED')).toBeDefined();
  });
});
