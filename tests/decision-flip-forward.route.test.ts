/**
 * SCIENCE ROBUSTNESS (EXPERIMENT; SCIENCE/DSK, #85; DL ruling 5948081549 condition 5): a /v2/run body carrying
 * `decision_flip` asks ISL for the recommendation's tipping point per link INSTEAD of a Run, reusing the Run's own ISL
 * request, and gets ISL's block back VERBATIM behind a structural guard. CEE is the validating boundary.
 *
 * The block below is REAL ISL wire output (worker `run_decision_flip_v2`, ISL #220 @51bab705; D1, K=4), not authored.
 * Harness modelled on tests/plot-remediation.base-call-budget.route.test.ts (call capture over a mocked service).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv from 'ajv';
import * as normalisation from '../src/normalisation/normalise-and-repair.js';
import { NormalisationError } from '../src/normalisation/graph-normaliser.js';
import * as translator from '../src/integrations/isl/translator-v3.js';
import * as admission from '../src/integrations/isl/compute-admission.js';
import { ISLHttpError } from '../src/integrations/isl/errors.js';
import type { ISLComputeAdmission } from '../src/integrations/isl/types/isl-types.js';
import { MAX_CONSTRAINTS } from '../src/constants/limits.js';
import { makeComputedIslResponse, makeValidRunBody } from './helpers/run-fixtures.js';

const entropy = vi.hoisted(() => ({ uuid: 0 }));
vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomUUID: () => `00000000-0000-4000-8000-${String(++entropy.uuid).padStart(12, '0')}` };
});

const ANALYZE = '/api/v1/robustness/analyze/v2';
const FLIP = '/api/v1/robustness/decision-flip/v2';
const ISL_D1_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"ai_reporting_module_sprint","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"sprint_capacity_for_ai_reporting","to_id":"ai_reporting_module_availability","status":"quoted","reason":null,"current_mean":0.25,"threshold":0.0625,"replicate_thresholds":[0.06125,0.06375,0.06125,0.06625],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"},{"from_id":"ai_reporting_module_availability","to_id":"enterprise_prospect_signing_likelihood","status":"absent","reason":"replicates_spread","current_mean":0.6,"threshold":null,"replicate_thresholds":[0.14125000000000001,0.15125,0.15624999999999997,0.15874999999999997],"replicate_range":0.01749999999999996,"to_option_id":null},{"from_id":"enterprise_prospect_signing_likelihood","to_id":"quarterly_revenue","status":"quoted","reason":null,"current_mean":0.5,"threshold":0.08875000000000002,"replicate_thresholds":[0.08625000000000002,0.09125000000000003,0.08875000000000002,0.08875000000000002],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"}]};

type IslError = { code: string; message: string; retryable: boolean; status?: number };
const calls: Array<{ endpoint: string; body: any }> = [];
let flipAnswer: { data: unknown; error?: IslError } = { data: ISL_D1_BLOCK };

let islEnabled = true;
let islThrow: Error | undefined;
let enabledThrow: Error | undefined;
let analysisError: IslError | undefined;
const mockISLService = {
  isEnabled(): boolean { if (enabledThrow) throw enabledThrow; return islEnabled; },
  async isAvailable(): Promise<boolean> { return true; },
  async callAnalysisEndpoint<T>(endpoint: string, body: unknown): Promise<{ data: T | null; error?: IslError }> {
    calls.push({ endpoint, body: JSON.parse(JSON.stringify(body)) });
    if (islThrow) throw islThrow;
    if (endpoint === FLIP) return { data: (flipAnswer.data ?? null) as T | null, error: flipAnswer.error };
    return analysisError ? { data: null, error: analysisError } : { data: makeComputedIslResponse() as T };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, get islService() { return mockISLService; } };
});

import { createServer } from '../src/createServer.js';

const LINKS = [{ from_id: 'factor-0', to_id: 'goal' }];

describe('decision_flip on /v2/run — forward ISL\'s block verbatim, typed reason otherwise', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });
  beforeEach(() => {
    calls.length = 0;
    flipAnswer = { data: ISL_D1_BLOCK };
    islEnabled = true;
    islThrow = enabledThrow = undefined;
    analysisError = undefined;
    // A fresh unconfigured admission makes the test hermetic (no /health I/O).
    admission.__setIslComputeAdmissionForTest({ admission: null, skew: false, status: 'disabled' });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); admission.__resetIslComputeAdmission(); });

  const post = (extra: Record<string, unknown> = {}) => {
    entropy.uuid = 0;
    return app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody(extra) });
  };


  // Baselines are captured RED-first from the PR head. Preserve every wire byte
  // after replacing only runtime entropy: UUIDs, timestamps and elapsed times.
  const stableWire = (wire: string): string => JSON.stringify(JSON.parse(wire, (key, value) => {
    if (typeof value === 'number' && /(?:_ms|Ms)$/.test(key)) return '<elapsed>';
    if (typeof value === 'string') return value
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
      .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\b/g, '<timestamp>');
    return value;
  }));
  type ExitRow = {
    id: string; code: string; status?: number; extra?: Record<string, unknown>;
    setup?: () => void; reason?: string; retryable?: boolean; upstreamStatus?: number | null;
  };
  const changedOption = (value: unknown) => ({ options: [
    { id: 'opt-a', label: 'Option A', interventions: { 'factor-0': value } },
    makeValidRunBody().options[1],
  ] });
  const constraint = { constraint_id: 'limit', node_id: 'factor-0', operator: '>=', value: 0.1 };
  const seededAdmission = (overrides: Partial<ISLComputeAdmission> = {}, retained = false) => {
    const block: ISLComputeAdmission = {
      complexity_formula_version: 'v2-weighted-2026-07', max_cost_units: 24_000_000,
      weights: { base_per_sample_per_option_per_struct: 1, evpi_sample_cap: 2000,
        sensitivity_coef: 4, evalue_coef: 20, bands_coef: 200, path_coef: 1, max_decomposition_paths: 20000 },
      caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 50 },
      formula_parameters: { sensitivity: { subsample_cap: 100, subsample_divisor: 10 } },
      ...overrides,
    };
    admission.__setIslComputeAdmissionForTest({ admission: block, skew: retained, status: retained ? 'unreachable' : 'ok',
      ...(retained ? { retainedAdmissionVersion: block.complexity_formula_version } : { advertisedVersion: block.complexity_formula_version }),
    });
  };
  const rows: ExitRow[] = [
    { id: 'categorical-integrity', code: 'NOMINAL_INTERVENTION_NOT_SUPPORTED', extra: JSON.parse(readFileSync(new URL('./fixtures/c1-categorical-direct.json', import.meta.url), 'utf8')) },
    { id: 'intervention-value', code: 'INVALID_INTERVENTION_VALUE', extra: changedOption(null) },
    { id: 'intervention-range', code: 'INVALID_INTERVENTION_RANGE', extra: { options: [
      { ...makeValidRunBody().options[0], intervention_ranges: { 'factor-0': { low: 2, high: 1, meaning: 'bounds' } } },
      makeValidRunBody().options[1],
    ] } },
    { id: 'normalisation-error', code: 'NORMALIZATION_ERROR', setup: () => {
      vi.spyOn(normalisation, 'normaliseGraphWithRepairs').mockImplementation(() => { throw new NormalisationError('test normalisation refusal', 'nodes'); });
    } },
    { id: 'missing-goal', code: 'MISSING_GOAL_NODE', extra: { goal_node_id: ' ' } },
    { id: 'unknown-goal', code: 'GOAL_NODE_NOT_IN_GRAPH', extra: { goal_node_id: 'missing' } },
    { id: 'noncausal-goal', code: 'GOAL_NODE_NOT_CAUSAL', extra: { goal_node_id: 'decision', graph: {
      ...makeValidRunBody().graph, nodes: [...makeValidRunBody().graph.nodes, { id: 'decision', kind: 'decision', label: 'Decision' }],
    } } },
    { id: 'constraint-count', code: 'TOO_MANY_CONSTRAINTS', extra: { goal_constraints: Array.from({ length: MAX_CONSTRAINTS + 1 }, (_, i) => ({ ...constraint, constraint_id: `limit-${i}` })) } },
    { id: 'constraint-shape', code: 'INVALID_CONSTRAINT_SHAPE', extra: { goal_constraints: [{ ...constraint, operator: '>' }] } },
    { id: 'constraint-validation', code: 'CONSTRAINT_TARGET_NOT_FOUND', extra: { goal_constraints: [{ ...constraint, node_id: 'missing' }] } },
    { id: 'preflight', code: 'NO_PATH_TO_GOAL', extra: { graph: { ...makeValidRunBody().graph, edges: [] } } },
    { id: 'withheld-options', code: 'INTERVENTION_CLAMPED_NO_COMPARISON', extra: {
      ...changedOption(200), graph: { ...makeValidRunBody().graph, nodes: [
        { ...makeValidRunBody().graph.nodes[0], observed_state: { value: 0.5 }, factor_scale: { min: 0, max: 100 } },
        makeValidRunBody().graph.nodes[1],
      ] },
    } },
    ...(['unreachable', 'warming', 'missing_block', 'unknown_version', 'unknown_weight_keys', 'unknown_cap_keys', 'missing_formula_parameters', 'unknown_formula_parameters'] as const).map((status): ExitRow => ({
      id: `admission-${status}`, code: 'ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE', status: 503,
      reason: 'ISL_ERROR', upstreamStatus: 503, retryable: true,
      setup: () => admission.__setIslComputeAdmissionForTest({ admission: null, skew: true, status }),
    })),
    ...(['cold', 'stale'] as const).map((state): ExitRow => ({
      id: `admission-${state}`, code: 'ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE', status: 503,
      reason: 'ISL_ERROR', upstreamStatus: 503, retryable: true,
      setup: () => {
        vi.stubEnv('ISL_BASE_URL', 'https://isl.test'); vi.stubEnv('ISL_API_KEY', 'test');
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline health fixture'); }));
        if (state === 'cold') admission.__resetIslComputeAdmission();
        else {
          const now = Date.now();
          vi.spyOn(Date, 'now').mockReturnValueOnce(now - 120_000);
          admission.__setIslComputeAdmissionForTest({ admission: null, skew: true, status: 'unreachable' });
        }
      },
    })),
    { id: 'admission-cap', code: 'GRAPH_TOO_COMPLEX', setup: () => {
      seededAdmission({ caps: { max_options: 10, max_nodes: 1, max_edges: 200, max_parameter_uncertainties: 50 } });
    } },
    { id: 'admission-budget', code: 'GRAPH_TOO_COMPLEX', setup: () => { seededAdmission({ max_cost_units: 1 }); } },
    { id: 'retained-admission-cap', code: 'GRAPH_TOO_COMPLEX', setup: () => {
      seededAdmission({ caps: { max_options: 10, max_nodes: 1, max_edges: 200, max_parameter_uncertainties: 50 } }, true);
    } },
    { id: 'retained-admission-budget', code: 'GRAPH_TOO_COMPLEX', setup: () => { seededAdmission({ max_cost_units: 1 }, true); } },
    { id: 'isl-disabled', code: 'ISL_NOT_ENABLED', status: 200, reason: 'ISL_NOT_ENABLED', upstreamStatus: null, setup: () => { islEnabled = false; } },
    { id: 'duplicate-edge', code: 'DUPLICATE_EDGE_CONFLICT', extra: { graph: {
      ...makeValidRunBody().graph, edges: [makeValidRunBody().graph.edges[0], { ...makeValidRunBody().graph.edges[0], strength: { mean: 0.4, std: 0.05 } }],
    } } },
    { id: 'isl-request-validation', code: 'ISL_REQUEST_INVALID', setup: () => {
      vi.spyOn(translator, 'validateISLRequest').mockReturnValue(['test request refusal']);
    } },
    { id: 'inner-defensive-http', code: 'ISL_CALL_FAILED', status: 200, reason: 'ISL_ERROR', upstreamStatus: 503, retryable: true,
      setup: () => { islThrow = new ISLHttpError(503, 'test unavailable', FLIP); } },
    { id: 'inner-defensive-nonretryable', code: 'ISL_CALL_FAILED', status: 200, reason: 'ISL_ERROR', upstreamStatus: 401, retryable: false,
      setup: () => { islThrow = new ISLHttpError(401, 'test auth refusal', FLIP); } },
    { id: 'inner-defensive-generic', code: 'ISL_CALL_FAILED', status: 200, reason: 'ISL_ERROR', upstreamStatus: null, retryable: true,
      setup: () => { islThrow = new Error('test service exception'); } },
    { id: 'outer-defensive', code: 'PLOT_INTERNAL_ERROR', status: 200, reason: 'ISL_ERROR', upstreamStatus: null, retryable: true,
      setup: () => { enabledThrow = new Error('test enabled exception'); } },
    { id: 'normalisation-rethrow', code: 'PLOT_INTERNAL_ERROR', status: 200, reason: 'ISL_ERROR', upstreamStatus: null, retryable: true, setup: () => {
      vi.spyOn(normalisation, 'normaliseGraphWithRepairs').mockImplementation(() => { throw new Error('test unexpected normalisation exception'); });
    } },
    { id: 'isl-503', code: 'ISL_CALL_FAILED', status: 200, reason: 'ISL_ERROR', upstreamStatus: 503, retryable: true, setup: () => {
      analysisError = { code: 'ISL_ERROR', message: 'test upstream unavailable', retryable: true, status: 503 };
      flipAnswer = { data: null, error: analysisError };
    } },
  ];

  it.each(rows)('$id: typed flip carrier and unchanged ordinary Run at the identical exit', async (row) => {
    row.setup?.();
    const requestId = `df-${row.id}`;
    const extra = { ...row.extra, request_id: requestId };
    const ordinary = await post(extra);
    expect(ordinary.statusCode).toBe(row.status ?? 422);
    expect(ordinary.json().critiques.map((c: { code: string }) => c.code)).toContain(row.code);
    expect(ordinary.json()).not.toHaveProperty('decision_flip');
    expect(ordinary.headers['x-request-id']).toBe(requestId);
    expect(ordinary.json().request_id ?? ordinary.json().meta.request_id).toBe(requestId);
    expect(stableWire(ordinary.body)).toMatchSnapshot();
    calls.length = 0;
    const res = await post({ ...extra, decision_flip: { links: LINKS } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({
      decision_flip: null,
      decision_flip_unavailable: {
        reason: row.reason ?? 'ISL_REJECTED',
        status: row.upstreamStatus === undefined ? 422 : row.upstreamStatus,
        retryable: row.retryable ?? false,
      },
      meta: { request_id: requestId },
    });
    expect(calls.map((c) => c.endpoint)).toEqual(row.id.startsWith('inner-') || row.id === 'isl-503' ? [FLIP] : []);
  });

  it('usable retained admission: forwards the block and preserves the ordinary Run', async () => {
    seededAdmission({}, true);
    const requestId = 'df-retained-admission';
    const ordinary = await post({ request_id: requestId });
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json().analysis_status).toBe('computed');
    expect(stableWire(ordinary.body)).toMatchSnapshot();
    calls.length = 0;
    const res = await post({ request_id: requestId, decision_flip: { links: LINKS } });
    expect(res.json()).toStrictEqual({ decision_flip: ISL_D1_BLOCK, decision_flip_unavailable: null, meta: { request_id: requestId } });
    expect(calls.map((c) => c.endpoint)).toEqual([FLIP]);
  });

  it('null-leader block: passthrough remains opaque and the ordinary Run is unchanged', async () => {
    const requestId = 'df-null-leader';
    const block = { ...ISL_D1_BLOCK, leader_option_id: null };
    flipAnswer = { data: block };
    const ordinary = await post({ request_id: requestId });
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.json().analysis_status).toBe('computed');
    expect(stableWire(ordinary.body)).toMatchSnapshot();
    calls.length = 0;
    const res = await post({ request_id: requestId, decision_flip: { links: LINKS } });
    expect(res.json()).toStrictEqual({ decision_flip: block, decision_flip_unavailable: null, meta: { request_id: requestId } });
    expect(calls.map((c) => c.endpoint)).toEqual([FLIP]);
  });

  it('the published 200 schema validates actual successful and unavailable route responses', async () => {
    const spec = parse(readFileSync(new URL('../contracts/openapi.yaml', import.meta.url), 'utf8'));
    const schema = spec.paths['/v2/run'].post.responses['200'].content['application/json'].schema;
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validate = ajv.compile({ ...schema, components: spec.components });
    const requestId = 'df-published-success';
    const success = await post({ request_id: requestId, decision_flip: { links: LINKS } });
    expect(success.json().decision_flip).toStrictEqual(ISL_D1_BLOCK);
    expect(validate(success.json()), JSON.stringify(validate.errors)).toBe(true);
    flipAnswer = { data: null, error: { code: 'ISL_ERROR', message: 'test unavailable', status: 503, retryable: true } };
    const unavailable = await post({ request_id: 'df-published-unavailable', decision_flip: { links: LINKS } });
    expect(unavailable.json().decision_flip_unavailable).toStrictEqual({ reason: 'ISL_ERROR', status: 503, retryable: true });
    expect(validate(unavailable.json()), JSON.stringify(validate.errors)).toBe(true);
    // Discriminating controls: the transport schema must not admit contradictory carriers.
    expect(validate({ ...unavailable.json(), decision_flip: ISL_D1_BLOCK })).toBe(false);
    expect(validate({ ...success.json(), decision_flip: null })).toBe(false);
    expect(validate({ ...unavailable.json(), decision_flip_unavailable: { reason: 'NEW_REASON', status: null, retryable: false } })).toBe(false);
    // A real disabled Run exercises the unchanged Run branch. The computed
    // fixture has pre-existing OpenAPI enum drift at min_attribution_stability
    // (null); this transport change deliberately leaves runResponseV3 intact.
    islEnabled = false;
    const ordinary = await post({ request_id: 'df-published-ordinary' });
    expect(validate(ordinary.json()), JSON.stringify(validate.errors)).toBe(true);
  });

  it('asks ISL ONCE, with the Run\'s own ISL request, and returns the block verbatim with no analysis', async () => {
    const run = await post({ request_id: 'df-row-1' });
    expect(run.statusCode).toBe(200);
    const analyzeBody = calls.find((c) => c.endpoint === ANALYZE)!.body;
    calls.length = 0;

    const res = await post({ request_id: 'df-row-1', decision_flip: { links: LINKS } });
    expect(res.statusCode).toBe(200);
    expect(calls.map((c) => c.endpoint)).toEqual([FLIP]); // no analysis call, before or after
    expect(calls[0].body).toEqual({ request: analyzeBody, links: LINKS, replicates: 4 });
    const out = res.json();
    expect(out.decision_flip).toStrictEqual(ISL_D1_BLOCK);
    expect(out.decision_flip_unavailable).toBeNull();
    expect(out).not.toHaveProperty('analysis_status');
    expect(out).not.toHaveProperty('results');
  });

  it('forwards the caller\'s replicates', async () => {
    await post({ decision_flip: { links: LINKS, replicates: 6 } });
    expect(calls[0].body.replicates).toBe(6);
  });

  it('a body that is not ISL\'s block is a typed DECISION_FLIP_MALFORMED on a 200, never forwarded', async () => {
    for (const data of [makeComputedIslResponse(), { ...ISL_D1_BLOCK, method: 'something_else' }, [ISL_D1_BLOCK]]) {
      flipAnswer = { data };
      const res = await post({ decision_flip: { links: LINKS } });
      expect(res.statusCode).toBe(200);
      expect(res.json().decision_flip).toBeNull();
      expect(res.json().decision_flip_unavailable).toEqual({ reason: 'DECISION_FLIP_MALFORMED', status: null, retryable: false });
    }
  });

  it('an ISL failure is its typed reason on a 200 (timeout; the unmounted route\'s 404), never a 5xx', async () => {
    flipAnswer = { data: null, error: { code: 'ISL_TIMEOUT', message: 'timed out', retryable: true } };
    let res = await post({ decision_flip: { links: LINKS } });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision_flip_unavailable).toEqual({ reason: 'ISL_TIMEOUT', status: null, retryable: true });
    flipAnswer = { data: null, error: { code: 'ISL_ERROR', message: 'Not Found', retryable: false, status: 404 } };
    res = await post({ decision_flip: { links: LINKS } });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision_flip_unavailable).toEqual({ reason: 'ISL_ERROR', status: 404, retryable: false });
    expect(res.json().decision_flip).toBeNull();
  });

  it('control: a body without decision_flip runs the analysis exactly as before', async () => {
    const res = await post();
    expect(calls.map((c) => c.endpoint)).toEqual([ANALYZE]);
    expect(res.json()).not.toHaveProperty('decision_flip');
    expect(res.json().analysis_status).toBeDefined();
  });

  it('the body shape is bounded: no links or replicates out of 2..8 is a 400; an unknown nested key never reaches ISL', async () => {
    for (const decision_flip of [{ links: [] }, { links: LINKS, replicates: 9 }, { links: LINKS, replicates: 1 }, { replicates: 4 }]) {
      const res = await post({ decision_flip });
      expect(res.statusCode, JSON.stringify(decision_flip)).toBe(400);
    }
    expect(calls).toEqual([]);
    // PLoT's Ajv strips undeclared nested keys (Fastify removeAdditional, as for every /v2/run sub-object); the
    // top-level allowlist is what rejects. Either way an undeclared key cannot reach ISL.
    await post({ decision_flip: { links: [{ ...LINKS[0], weight: 1 }], extra: 1 } });
    expect(calls[0].body).toEqual({ request: expect.any(Object), links: LINKS, replicates: 4 });
  });
});
