/**
 * INSTANCE B — a fabricated "measured zero" breach margin from a wire `null`.
 * ============================================================================
 * Found by the #276 lane, flagged not fixed; verified here at the bytes.
 *
 * THE DEFECT. The deployed ISL sends `failure_margin_median: null` for an
 * absent margin — MEASURED, not assumed, and recorded in PLoT's own source:
 *
 *   src/integrations/isl/types/isl-types.ts:558-563
 *     "The route serialises with `exclude_none=True`, but that does not reach
 *      inside this object: `failure_margin_median` and `near_miss_fraction`
 *      come back null on the same wire too."
 *
 * The interface nevertheless declared `failure_margin_median?: number` — a
 * compile-time fiction over untrusted wire data. Both denormalisation sites
 * then guarded with `!== undefined`:
 *
 *     let fmm = c.failure_margin_median;              // null
 *     if (fmm !== undefined && constraintNormRanges) {  // null !== undefined → TRUE
 *       fmm = fmm * rangeWidth;                         // null * 60000 === 0
 *     }
 *     fmm = nonNeg(fmm);                                // nonNeg(0) === 0 → PASSES
 *
 * — so an absent margin shipped as `failure_margin_median: 0`: a PRECISE,
 * MEASURED-LOOKING zero meaning "this option breaches by exactly nothing".
 *
 * WHY THIS IS THE SHARPEST FORM. The comment directly above that code claims
 * the fabrication is already dead:
 *
 *     "Absent ≠ zero: keep undefined undefined (kill the `?? 0` fabrication)."
 *
 * It killed the `?? 0` — for `undefined`, a shape ISL does not send. The live
 * `null` walked straight past it. tests/constraint-margin-plumbing.test.ts
 * pins "missing margin is DISTINGUISHABLE from a zero margin" using
 * `undefined`, so the existing control passed while the live shape fabricated.
 * A control pinned to a shape the producer never emits is a control that tests
 * nothing (the estate's trap-12b, in the data plane).
 *
 * WHAT THE FABRICATED ZERO COSTS. The plumbing suite's own header records that
 * fabricated zeros from the earlier `?? 0` were read by a live probe as
 * positive evidence that "the constraint signal is a hard step, ranking by
 * degree of breach is impossible" — a false architectural conclusion that was
 * written into a design plan. This is that same defect, resurrected in the
 * shape ISL actually sends.
 *
 * ASYMMETRY (deliberately pinned below): `near_miss_fraction: null` is SAFE,
 * because it goes through `prob01()` BEFORE any arithmetic and prob01 rejects
 * null. Only `failure_margin_median` is coerced before it is guarded. The
 * general bug is the ORDER — validate, then compute — not the field.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prob01, nonNeg } from '../src/routes/v2/numeric-egress-guards.js';

/** option_id → constraint_analysis (undefined entry = ISL sent none for it). */
let mockConstraintAnalysisByOption: Record<string, any> = {};

function buildMockOption(opt: any, idx: number) {
  const analysis = mockConstraintAnalysisByOption[opt.id];
  return {
    option_id: opt.id,
    outcome: {
      mean: 0.7 - idx * 0.1,
      std: 0.1,
      p10: 0.5,
      p50: 0.7,
      p90: 0.9,
      n_samples: 1000,
      n_valid_samples: 1000,
      validity_ratio: 1.0,
    },
    rank: idx + 1,
    win_probability: 0.3,
    status: 'computed',
    ...(analysis !== undefined && { constraint_analysis: analysis }),
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable',
      confidence: 'high',
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' },
      source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map(buildMockOption),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const,
      robustness_score: 0.8,
      fragile_edges: [],
      robust_edges: [],
      latency_ms: 50,
      source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    return {
      data: {
        options: options.map(buildMockOption),
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust',
        robustness_score: 0.8,
        fragile_edges: [],
        robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

/**
 * `fac_cost` carries an explicit cap, so its normalisation range is [0, 60000]
 * from a PRODUCER-DECLARED scale. That is what makes `constraintNormRanges`
 * populated and `rangeWidth = 60000 > 0` — i.e. the denormalisation multiply
 * actually RUNS. Without it the null would never be coerced and this suite
 * would pass vacuously.
 */
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
    { id: 'fac_cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 40000, cap: 60000, unit: '£' } },
  ],
  edges: [{ from: 'fac_cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }],
};

const OPTIONS = [
  { id: 'opt_under', label: 'Under budget', interventions: { fac_cost: 38000 } },
  { id: 'opt_just_over', label: 'Just over budget', interventions: { fac_cost: 52000 } },
];

const CONSTRAINT_ID = 'c_cost_cap';
const GOAL_CONSTRAINTS = [
  { constraint_id: CONSTRAINT_ID, node_id: 'fac_cost', operator: '<=', value: 50000, label: 'First-year cost cap', unit: '£' },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

/**
 * An ISL constraint row in the shape the DEPLOYED service actually sends.
 * `margin`/`nearMiss` are written VERBATIM — pass `null` to reproduce the live
 * wire, a number for the positive control. Note the fields are always PRESENT
 * (that is the point: ISL sends the key with a null value, it does not omit it).
 */
function islConstraintVerbatim(probSatisfied: number, margin: unknown, nearMiss: unknown) {
  return {
    constraints: [
      {
        constraint_id: CONSTRAINT_ID,
        node_id: 'fac_cost',
        operator: '<=',
        value: 50000,
        prob_satisfied: probSatisfied,
        failure_margin_median: margin,
        near_miss_fraction: nearMiss,
        binding: true,
      },
    ],
    joint_probability: probSatisfied,
  };
}

async function runAnalysis(app: FastifyInstance, payload: object): Promise<any> {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function marginEntry(body: any, optionId: string): any {
  const entry = (body.option_comparison ?? []).find((o: any) => o.option_id === optionId);
  expect(entry, `option_comparison entry for ${optionId}`).toBeDefined();
  return (entry.constraint_margins ?? []).find((m: any) => m.constraint_id === CONSTRAINT_ID);
}

function diagnosticEntry(body: any): any {
  return (body.constraint_diagnostics ?? []).find((d: any) => d.constraint_id === CONSTRAINT_ID);
}

describe('INSTANCE B — a wire `null` margin must never become a measured zero', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  beforeEach(() => {
    mockConstraintAnalysisByOption = {};
  });

  // =========================================================================
  // POSITIVE CONTROLS FIRST — prove the harness can SEE a real margin.
  // Every absence assertion below is vacuous without these (trap 13).
  // =========================================================================

  describe('positive controls — a genuine numeric margin still flows, denormalised', () => {
    it('a real failure_margin_median reaches egress in user units', async () => {
      mockConstraintAnalysisByOption = {
        opt_under: islConstraintVerbatim(1.0, null, null),
        opt_just_over: islConstraintVerbatim(0.0, 0.03333, 1.0),
      };

      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      const entry = marginEntry(body, 'opt_just_over');

      expect(entry, 'the breaching option must carry its margin entry').toBeDefined();
      // 0.03333 × rangeWidth(60000) ≈ £2,000 over the £50,000 cap.
      expect(entry.failure_margin_median).toBeCloseTo(2000, 0);
      expect(entry.near_miss_fraction).toBe(1.0);
    });

    it('a real margin also reaches the top-level constraint_diagnostics', async () => {
      mockConstraintAnalysisByOption = {
        opt_under: islConstraintVerbatim(0.0, 0.03333, 1.0),
        opt_just_over: islConstraintVerbatim(0.0, 0.03333, 1.0),
      };

      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      const diag = diagnosticEntry(body);

      expect(diag, 'top-level diagnostics must carry the constraint').toBeDefined();
      expect(diag.failure_margin_median).toBeCloseTo(2000, 0);
      expect(diag.near_miss_fraction).toBe(1.0);
    });
  });

  // =========================================================================
  // RED — the defect.
  // =========================================================================

  describe('RED: failure_margin_median: null (the live ISL shape)', () => {
    beforeEach(() => {
      mockConstraintAnalysisByOption = {
        opt_under: islConstraintVerbatim(1.0, null, null),
        opt_just_over: islConstraintVerbatim(0.0, null, null),
      };
    });

    it('per-option constraint_margins emits NO failure_margin_median — not 0', async () => {
      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      const entry = marginEntry(body, 'opt_just_over');

      if (entry !== undefined) {
        expect(
          Object.prototype.hasOwnProperty.call(entry, 'failure_margin_median'),
          'ISL sent null (= not computed). A fabricated 0 reads as "breaches by exactly nothing".',
        ).toBe(false);
        expect(entry.failure_margin_median).not.toBe(0);
      }
    });

    it('per-option margin_precision is absent too — it is a claim ABOUT a margin that does not exist', async () => {
      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      const entry = marginEntry(body, 'opt_just_over');

      if (entry !== undefined) {
        expect(entry.margin_precision).toBeUndefined();
      }
    });

    it('top-level constraint_diagnostics emits NO failure_margin_median — not 0', async () => {
      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      const diag = diagnosticEntry(body);

      if (diag !== undefined) {
        expect(
          Object.prototype.hasOwnProperty.call(diag, 'failure_margin_median'),
          'a null margin must be an honest omission, never a measured zero',
        ).toBe(false);
        expect(diag.failure_margin_median).not.toBe(0);
      }
    });

    it('the whole response body contains no fabricated zero margin anywhere', async () => {
      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      // Scope: the serialised response. Claim type: no `failure_margin_median`
      // key anywhere carries the value 0 or null. Catches any THIRD site the
      // two named above miss.
      const offenders: string[] = [];
      const walk = (node: any, path: string): void => {
        if (node === null || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((v, i) => walk(v, `${path}[${i}]`));
          return;
        }
        for (const [k, v] of Object.entries(node)) {
          if (k === 'failure_margin_median' && (v === 0 || v === null)) {
            offenders.push(`${path}.${k} = ${JSON.stringify(v)}`);
          }
          walk(v, `${path}.${k}`);
        }
      };
      walk(body, '$');

      expect(offenders, 'no site may emit a fabricated/serialised-null margin').toEqual([]);
    });
  });

  // =========================================================================
  // The ASYMMETRY, pinned — near_miss_fraction is already safe, and WHY.
  // =========================================================================

  describe('near_miss_fraction: null is already safe (guard runs BEFORE arithmetic)', () => {
    it('emits no near_miss_fraction for a null, and never a 0', async () => {
      mockConstraintAnalysisByOption = {
        opt_under: islConstraintVerbatim(1.0, null, null),
        opt_just_over: islConstraintVerbatim(0.0, 0.03333, null),
      };

      const body = await runAnalysis(app, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      const entry = marginEntry(body, 'opt_just_over');

      expect(entry).toBeDefined();
      expect(entry.near_miss_fraction).toBeUndefined();
      // The margin on the SAME row is genuine and must survive — this is what
      // makes the assertion above a real discrimination and not blanket
      // suppression of the row.
      expect(entry.failure_margin_median).toBeCloseTo(2000, 0);
    });
  });

  // =========================================================================
  // GENERAL-SHAPE GUARD — the `!== undefined` bug class, not just this field.
  // =========================================================================

  describe('guard: null must not survive any numeric coercion in the changed paths', () => {
    it('the egress guards themselves reject null (and undefined), never returning 0', () => {
      expect(nonNeg(null)).toBeUndefined();
      expect(nonNeg(undefined)).toBeUndefined();
      expect(prob01(null)).toBeUndefined();
      expect(prob01(undefined)).toBeUndefined();
      // The trap: nonNeg ACCEPTS a real 0, so it can never undo a coercion
      // that already happened upstream. Ordering is the whole fix.
      expect(nonNeg(0)).toBe(0);
    });

    it('documents the coercion that made this a defect: null is not undefined, and multiplies to 0', () => {
      const wireValue: any = null;
      expect(wireValue !== undefined).toBe(true);        // the guard that failed
      expect(wireValue * 60000).toBe(0);                 // the fabrication
      expect(nonNeg(wireValue * 60000)).toBe(0);         // and nonNeg blesses it
      // Whereas validating FIRST refuses it outright:
      expect(nonNeg(wireValue)).toBeUndefined();
    });
  });
});
