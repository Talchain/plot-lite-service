/**
 * SCIENCE ROBUSTNESS (EXPERIMENT; SCIENCE/DSK, #85; DL ruling 5948081549 condition 5): a /v2/run body carrying
 * `decision_flip` asks ISL for the recommendation's tipping point per link INSTEAD of a Run, reusing the Run's own ISL
 * request, and gets ISL's block back VERBATIM behind a structural guard. CEE is the validating boundary.
 *
 * The block below is REAL ISL wire output (worker `run_decision_flip_v2`, ISL #220 @51bab705; D1, K=4), not authored.
 * Harness modelled on tests/plot-remediation.base-call-budget.route.test.ts (call capture over a mocked service).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeComputedIslResponse, makeValidRunBody } from './helpers/run-fixtures.js';

const ANALYZE = '/api/v1/robustness/analyze/v2';
const FLIP = '/api/v1/robustness/decision-flip/v2';
const ISL_D1_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"ai_reporting_module_sprint","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"sprint_capacity_for_ai_reporting","to_id":"ai_reporting_module_availability","status":"quoted","reason":null,"current_mean":0.25,"threshold":0.0625,"replicate_thresholds":[0.06125,0.06375,0.06125,0.06625],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"},{"from_id":"ai_reporting_module_availability","to_id":"enterprise_prospect_signing_likelihood","status":"absent","reason":"replicates_spread","current_mean":0.6,"threshold":null,"replicate_thresholds":[0.14125000000000001,0.15125,0.15624999999999997,0.15874999999999997],"replicate_range":0.01749999999999996,"to_option_id":null},{"from_id":"enterprise_prospect_signing_likelihood","to_id":"quarterly_revenue","status":"quoted","reason":null,"current_mean":0.5,"threshold":0.08875000000000002,"replicate_thresholds":[0.08625000000000002,0.09125000000000003,0.08875000000000002,0.08875000000000002],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"}]};

type IslError = { code: string; message: string; retryable: boolean; status?: number };
const calls: Array<{ endpoint: string; body: any }> = [];
let flipAnswer: { data: unknown; error?: IslError } = { data: ISL_D1_BLOCK };

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async callAnalysisEndpoint<T>(endpoint: string, body: unknown): Promise<{ data: T | null; error?: IslError }> {
    calls.push({ endpoint, body: JSON.parse(JSON.stringify(body)) });
    if (endpoint === FLIP) return { data: (flipAnswer.data ?? null) as T | null, error: flipAnswer.error };
    return { data: makeComputedIslResponse() as T };
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
  beforeEach(() => { calls.length = 0; flipAnswer = { data: ISL_D1_BLOCK }; });

  const post = (extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody(extra) });

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
