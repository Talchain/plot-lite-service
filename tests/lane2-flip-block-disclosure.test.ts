/**
 * A3 lane 2 Fix A (ROADMAP 2.31) — whole-block flip honesty, REWORKED FOR THE
 * PROBE RETIREMENT (ROADMAP 2.228-F3).
 *
 * THE GUARANTEE THIS FILE STILL PINS, unchanged in substance: a whole-BLOCK
 * flip-threshold failure must be visible ON THE WIRE, not only in a server-side
 * WARN. Without it, a crashed block is indistinguishable from "nothing to
 * compute" — an empty `flip_thresholds` + `flip_thresholds_status:
 * 'unavailable'` either way.
 *
 * WHAT CHANGED. The block's contents changed, so the way this file arms a
 * failure changed with them. Cases 2 and 3 below used to pin the PER-FACTOR
 * probe paths (`flip_reason: 'error'` from a failing ISL probe, and
 * `'timeout'` from FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS=0). Those paths NO LONGER
 * EXIST on /v2/run: the bisection probe is retired and flip values arrive
 * closed-form on the ISL envelope, so there is no per-probe ISL call to fail
 * and no per-factor deadline to expire.
 *
 * They are not deleted silently. Each is REPLACED by the guarantee that now
 * occupies its ground:
 *   2. ISL emits NO factor_flip_values block → honestly empty + 'unavailable',
 *      and NO whole-block warning — because nothing FAILED, it was simply not
 *      computed (ISL discloses FACTOR_FLIPS_UNAVAILABLE on its own
 *      inference_warnings, which PLoT merges). Conflating "not computed" with
 *      "crashed" is the exact confusion this file exists to prevent.
 *   3. the retired probe budget is inert: no probe traffic is issued at all,
 *      and FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS=0 no longer produces 'timeout'
 *      rows — it produces nothing, because nothing probes.
 *
 * Case 1 (whole-block throw) now arms the throw in the MAPPING ADAPTER, which
 * is what the try/catch at run.ts wraps today.
 *
 * Harness: mock ISL captures every analyze/v2 body (so probe ABSENCE is proven
 * by a mock that can SEE presence), + the importOriginal-spread rule for module
 * mocks (only mapIslFactorFlipValues is wrapped, and it delegates to the REAL
 * implementation unless the whole-block toggle is armed).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { redactPayloadShape } from '../src/util/pii-redact.js';

// ---------------------------------------------------------------------------
// Toggles read at call time by the mocks
// ---------------------------------------------------------------------------
let blockThrow = false;      // arm → the mapping adapter throws (whole-block failure)
let islOmitsBlock = false;   // arm → ISL returns no factor_flip_values at all
const capturedBodies: any[] = [];

/** Sentinel that must NEVER egress: lives only in the thrown error MESSAGE. */
const SECRET_VALUE = '0.987654321';

// ---------------------------------------------------------------------------
// Flip mapping mock — importOriginal spread; only mapIslFactorFlipValues wrapped.
// The spread is load-bearing (CLAUDE.md trap 12): a bare factory REPLACES the
// module, so every export added later would silently vanish.
// ---------------------------------------------------------------------------
vi.mock('../src/integrations/isl/adapters/factor-flip-values.ts', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    mapIslFactorFlipValues: (...args: any[]) => {
      if (blockThrow) {
        const err = new Error(`synthetic whole-block failure carrying secret ${SECRET_VALUE}`);
        err.name = 'MockFlipBlockError';
        throw err;
      }
      return actual.mapIslFactorFlipValues(...args);
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
    // ROADMAP 2.228-F3: closed-form flips ride the analysis response. Omitted
    // entirely when `islOmitsBlock` is armed — the budget-trip shape.
    ...(islOmitsBlock ? {} : { factor_flip_values: FACTOR_FLIP_VALUES }),
  };
}

/** ISL FactorFlipValueV2 rows for the two graph factors (exclude_none shape). */
const FACTOR_FLIP_VALUES = [
  {
    factor_id: 'factor-a',
    current_value: 0.6,
    flip_value: 0.78,
    direction: 'increase',
    flip_reason: 'found',
    alternative_winner_id: 'opt2',
    baseline_winner_id: 'opt1',
  },
  {
    factor_id: 'factor-b',
    current_value: 0.5,
    flip_reason: 'structurally_invariant',
    baseline_winner_id: 'opt1',
  },
];

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

describe('V2 Run · whole-block flip failure is wire-disclosed (post-probe-retirement)', () => {
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
    blockThrow = true; islOmitsBlock = false; capturedBodies.length = 0;
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

  it('REPLACES the per-factor ERROR case: an ABSENT ISL block is honestly empty and NOT a failure', async () => {
    // The retired probe could fail per factor and disclose flip_reason 'error'.
    // Nothing probes now, so the analogous degradation is ISL omitting the
    // block (its budget trip). The distinction this asserts is the whole point
    // of the file: "not computed" must NOT raise the whole-block FAILURE
    // warning, because nothing crashed — ISL discloses FACTOR_FLIPS_UNAVAILABLE
    // on its own inference_warnings, which PLoT merges.
    blockThrow = false; islOmitsBlock = true; capturedBodies.length = 0;
    try {
      const body = await run();
      expect(body.analysis_status).not.toBe('failed');
      expect(body.flip_thresholds).toEqual([]);
      expect(body.flip_thresholds_status).toBe('unavailable');
      // ⚠ 'unavailable', never 'all_no_effect' — an omitted block must never be
      // published as "no factor could change the leading option".
      expect(body.flip_thresholds_status).not.toBe('all_no_effect');
      expect(blockWarning(body)).toBeUndefined();
    } finally {
      islOmitsBlock = false;
    }
  });

  it('REVIEW S5 — `factor_flip_values` survives redaction as a KEY, not as prose', () => {
    // The note used to read `'ISL omitted factor_flip_values; …'` as a string
    // VALUE, and redactPayloadShape digests graph-derived tokens found inside
    // string values: operators saw `ISL omitted sha8:513e0c37_flip_values`, so
    // grepping the logs for the ISL field name during a flip outage found
    // nothing.
    //
    // This exercises the REDACTOR itself rather than grepping the source, so it
    // proves the property that made the original wrong — and its two halves are
    // each other's positive control: if redaction were a no-op the second
    // expectation would fail, and if it digested everything the first would.
    const redacted = redactPayloadShape({
      event: 'flip_thresholds_isl_block_absent',
      factor_flip_values: 'absent',
      note: 'ISL omitted factor_flip_values',
    }) as Record<string, unknown>;

    // The KEY is a declared contract key and is preserved verbatim — greppable.
    expect(Object.keys(redacted)).toContain('factor_flip_values');
    // The same name inside a VALUE is exactly what got mangled. Asserting the
    // mangling still happens is what keeps this test honest: the fix was to
    // stop relying on values, not to change the redactor.
    expect(redacted.note).not.toBe('ISL omitted factor_flip_values');

    // CALL-SITE CHECK. The assertion above proves the MECHANISM; this one
    // proves the route actually uses it. Declared for what it is: a source
    // mirror-check, weaker than a behavioural assertion (trap 16), used here
    // because intercepting pino's sonic-boom fd-1 stream from inside vitest is
    // the exact setup that produced a 0-byte capture and a vacuous pass
    // elsewhere in this repo (trap 13). A log line's shape is worth this much
    // and no more.
    const src = readFileSync(new URL('../src/routes/v2/run.ts', import.meta.url), 'utf8');
    const from = src.indexOf("event: 'flip_thresholds_isl_block_absent'");
    expect(from).toBeGreaterThan(-1);
    const record = src.slice(from, src.indexOf('});', from));
    expect(record).toContain('factor_flip_values:');
    expect(record).not.toMatch(/note:\s*'ISL omitted factor_flip_values/);
  });

  it('REPLACES the per-factor TIMEOUT case: the retired probe budget is inert', async () => {
    // FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS=0 used to expire every factor deadline
    // before Step 0 and produce a wire full of flip_reason 'timeout'. With the
    // bisection probe retired the variable reaches no code path at all: the
    // closed-form values ride the analysis response and are unaffected.
    blockThrow = false; islOmitsBlock = false; capturedBodies.length = 0;
    process.env.FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS = '0';
    try {
      const body = await run();
      expect(body.analysis_status).not.toBe('failed');
      const entries = body.flip_thresholds ?? [];
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e: any) => e.flip_reason === 'timeout')).toBe(false);
      // The real flip value survives a budget that no longer governs anything.
      expect(entries.some((e: any) => e.flip_value !== null)).toBe(true);
      expect(blockWarning(body)).toBeUndefined();
    } finally {
      delete process.env.FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS;
    }
  });

  it('THE RETIREMENT: no flip-probe traffic is issued, on a mock that can SEE probe traffic', async () => {
    // An absence assertion is vacuous unless it can observe a presence (trap
    // 13). `capturedBodies` records EVERY analyze/v2 body, and the positive
    // control below proves it is non-empty — so "zero probe bodies" is a
    // measurement, not a silent pass.
    blockThrow = false; islOmitsBlock = false; capturedBodies.length = 0;
    await run();
    expect(capturedBodies.length).toBeGreaterThan(0);   // the mock sees traffic
    expect(flipProbeBodies()).toHaveLength(0);          // ...and none of it is a probe
    expect(capturedBodies).toHaveLength(1);             // exactly the one analysis call
  });

  it('positive control: a healthy run → NO warning, flip_thresholds populated, closed-form values', async () => {
    blockThrow = false; islOmitsBlock = false; capturedBodies.length = 0;
    const body = await run();
    expect(body.analysis_status).not.toBe('failed');
    expect((body.flip_thresholds ?? []).length).toBeGreaterThan(0);
    expect(body.flip_thresholds_status).not.toBe('unavailable');
    expect(blockWarning(body)).toBeUndefined();
    // One found + one attested no-flip.
    expect(body.flip_thresholds_status).toBe('partial_no_effect');
  });
});
