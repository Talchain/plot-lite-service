/**
 * A3 lane 2 Fix A (ROADMAP 2.31 adjacency — whole-block flip honesty).
 *
 * Before this lane, a whole-BLOCK flip-threshold failure degraded to an
 * ABSENT/empty `flip_thresholds` + `flip_thresholds_status: 'unavailable'`
 * with only a server-side `flip_thresholds_error` WARN — indistinguishable on
 * the wire from "nothing to probe" — while per-factor failures were honestly
 * disclosed per entry (`flip_reason: 'timeout' | 'error' | ...`).
 *
 * This file pins the new disclosure AND that the per-factor paths are
 * byte-level unchanged:
 *   1. whole-block throw → FLIP_THRESHOLDS_UNAVAILABLE inference warning,
 *      severity 'warning', message carries the error NAME only (a sentinel
 *      value embedded in the error MESSAGE must never reach the wire),
 *      response stays 200/computed (non-blocking).
 *   2. per-factor probe ERROR → entries with flip_reason 'error', NO
 *      whole-block warning.
 *   3. per-factor TIMEOUT (deterministic: FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS=0
 *      expires the factor deadline before Step 0) → entries with flip_reason
 *      'timeout', NO whole-block warning.
 *   4. positive control: successful probes → NO new warning, flip_thresholds
 *      populated, probe traffic actually observed (the mock can see presence,
 *      so the absence assertions above are not vacuous).
 *
 * Harness modelled on tests/v2-run.flip-probe-seed.contract.test.ts (mock ISL
 * captures probe bodies) + the importOriginal-spread rule for module mocks
 * (only resolveFlipValues is wrapped, and it delegates to the REAL
 * implementation unless the whole-block toggle is armed).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Toggles read at call time by the mocks
// ---------------------------------------------------------------------------
let blockThrow = false;      // arm → resolveFlipValues throws (whole-block failure)
let probeError = false;      // arm → ISL probe calls fail (per-factor 'error' path)
const capturedBodies: any[] = [];

/** Sentinel that must NEVER egress: lives only in the thrown error MESSAGE. */
const SECRET_VALUE = '0.987654321';

// ---------------------------------------------------------------------------
// Flip module mock — importOriginal spread; only resolveFlipValues wrapped
// ---------------------------------------------------------------------------
vi.mock('../src/analysis/flip-thresholds.ts', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveFlipValues: async (...args: any[]) => {
      if (blockThrow) {
        const err = new Error(`synthetic whole-block failure carrying secret ${SECRET_VALUE}`);
        err.name = 'MockFlipBlockError';
        throw err;
      }
      return actual.resolveFlipValues(...args);
    },
  };
});

// ---------------------------------------------------------------------------
// ISL mock — same shape as the flip-probe-seed contract test
// ---------------------------------------------------------------------------
function optionComparison(options: any[]) {
  return (options ?? []).map((opt: any, idx: number) => ({
    option_id: opt.id,
    win_probability: 0.6 - idx * 0.2,
    outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    rank: idx + 1,
  }));
}

function robustnessData(options: any[]) {
  return {
    options: optionComparison(options),
    edges: [
      { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
    ],
    factors: [
      { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
    ],
    value_of_information: [],
    overall_robustness: 'robust', robustness_score: 0.82,
    fragile_edges: [], robust_edges: [],
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      ...robustnessData(options),
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedBodies.push(body);
    const isProbe = typeof body?.request_id === 'string' && body.request_id.includes('__flip');
    if (probeError && isProbe) {
      return { data: null, error: 'probe unavailable (mock)' };
    }
    return { data: robustnessData(body?.options ?? []) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

// Two factors each intervened by a DIFFERENT option → neither overridden-by-all
// → both stay flip candidates → the probe path runs.
const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
      { id: 'factor-b', kind: 'factor', label: 'Customer Churn', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
    { id: 'opt2', label: 'Reduce Churn', interventions: { 'factor-b': 0.3 } },
  ],
  goal_node_id: 'goal',
  seed: '424242',
};

function flipProbeBodies() {
  return capturedBodies.filter((b) => typeof b?.request_id === 'string' && b.request_id.includes('__flip'));
}

function blockWarning(body: any) {
  return (body.inference_warnings ?? []).find((w: any) => w.code === 'FLIP_THRESHOLDS_UNAVAILABLE');
}

describe('V2 Run · whole-block flip failure is wire-disclosed; per-factor paths unchanged', () => {
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

  async function run() {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('whole-block failure → FLIP_THRESHOLDS_UNAVAILABLE warning with error NAME only; non-blocking; field honestly empty', async () => {
    blockThrow = true; probeError = false; capturedBodies.length = 0;
    try {
      const body = await run();
      // non-blocking degradation preserved
      expect(body.analysis_status).not.toBe('failed'); // non-blocking: mock fixture computes 'partial' (a sub-feature is unavailable in the mock shape); the flip block must never degrade it to 'failed'
      expect(body.flip_thresholds).toEqual([]);
      expect(body.flip_thresholds_status).toBe('unavailable');
      // NEW: the failure is on the wire, not just in the server log
      const warning = blockWarning(body);
      expect(warning).toBeDefined();
      expect(warning.severity).toBe('warning');
      expect(warning.message).toContain('attempted');
      // error NAME only — never the message or any value
      expect(warning.message).toContain('MockFlipBlockError');
      expect(JSON.stringify(body)).not.toContain(SECRET_VALUE);
    } finally {
      blockThrow = false;
    }
  });

  it('per-factor probe ERROR path unchanged: flip_reason entries on the wire, NO whole-block warning', async () => {
    blockThrow = false; probeError = true; capturedBodies.length = 0;
    try {
      const body = await run();
      expect(body.analysis_status).not.toBe('failed'); // non-blocking: mock fixture computes 'partial' (a sub-feature is unavailable in the mock shape); the flip block must never degrade it to 'failed'
      // probes were attempted and failed per factor
      expect(flipProbeBodies().length).toBeGreaterThan(0);
      const entries = body.flip_thresholds ?? [];
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.flip_value ?? null).toBeNull();
        expect(e.flip_reason).toBe('error');
      }
      // the whole-block warning must NOT fire for per-factor failures
      expect(blockWarning(body)).toBeUndefined();
    } finally {
      probeError = false;
    }
  });

  it('per-factor TIMEOUT path unchanged: flip_reason "timeout" entries, NO whole-block warning', async () => {
    blockThrow = false; probeError = false; capturedBodies.length = 0;
    process.env.FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS = '0';
    try {
      const body = await run();
      expect(body.analysis_status).not.toBe('failed'); // non-blocking: mock fixture computes 'partial' (a sub-feature is unavailable in the mock shape); the flip block must never degrade it to 'failed'
      const entries = body.flip_thresholds ?? [];
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.flip_value ?? null).toBeNull();
        expect(e.flip_reason).toBe('timeout');
      }
      expect(blockWarning(body)).toBeUndefined();
    } finally {
      delete process.env.FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS;
    }
  });

  it('positive control: successful probes → NO new warning, flip_thresholds populated, probe traffic observed', async () => {
    blockThrow = false; probeError = false; capturedBodies.length = 0;
    const body = await run();
    expect(body.analysis_status).not.toBe('failed'); // non-blocking: mock fixture computes 'partial' (a sub-feature is unavailable in the mock shape); the flip block must never degrade it to 'failed'
    expect(flipProbeBodies().length).toBeGreaterThan(0);
    expect((body.flip_thresholds ?? []).length).toBeGreaterThan(0);
    expect(body.flip_thresholds_status).not.toBe('unavailable');
    expect(blockWarning(body)).toBeUndefined();
  });
});
