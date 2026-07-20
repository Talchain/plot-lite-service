/**
 * A3 PLUMBING SPLIT (2026-07-20) of b4's constraint-eligibility-gate.test.ts.
 *
 * This lane builds ONLY additive plumbing so ISL's graded breach signal reaches
 * egress with absent!=zero. The eligibility-GATE CROWNING DOCTRINE (b4's
 * provisional prob_satisfied<0.5=ineligible + infeasible-leader demotion +
 * "nothing qualifies" withheld + tri-state unknown crowning) is UNRATIFIED
 * (b4 §6) and therefore EXCLUDED. The 4 doctrine tests below are `it.skip`
 * (pending doctrine ratification); the plumbing + 2 GREEN positive controls
 * stay active as this lane's RED-first targets:
 *   ACTIVE  Part1.1 per-option margins reach egress (RED)
 *   ACTIVE  Part1.2 missing-vs-zero distinguishable (RED)
 *   ACTIVE  Part1.3 clamp precision lower_bound (RED)
 *   ACTIVE  Part3.1 ingress guard: well-formed constraint passes (positive control)
 *   ACTIVE  Part3.2-4 ingress guard: malformed constraint_id/node_id -> 422 (RED)
 *   ACTIVE  Part2 all-feasible -> argmax crowned (GREEN positive control)
 *   ACTIVE  Part2 no-constraints -> argmax crowned (GREEN positive control)
 *   SKIP    Part2 status parity (DEFERRED — crowning-adjacent, follow-on lane)
 *   SKIP    Part2 infeasible-leader demotion       (doctrine)
 *   SKIP    Part2 nothing-qualifies withheld       (doctrine)
 *   SKIP    Part2 tri-state unknown crowning       (doctrine)
 *   SKIP    Part2 per-option constraint_eligibility (uses unratified <0.5 rule)
 *
 * B4 / L2 — constraint eligibility gate + per-option graded breach margins.
 *
 * Two lanes of coverage, both route-level (the whole /v2/run mapping):
 *
 * PART 1 — STOP DROPPING ISL'S GRADED BREACH SIGNAL.
 *   ISL computes `failure_margin_median` / `near_miss_fraction` PER OPTION.
 *   PLoT read only `prob_satisfied` per option, and read the top-level
 *   diagnostics off the FIRST option carrying constraints — which is the
 *   SATISFYING option, and a satisfying option by definition carries no
 *   margin. Two `?? 0` defaults then manufactured `failure_margin_median: 0,
 *   near_miss_fraction: 0`, and those fabricated zeros were read by a live
 *   probe as positive evidence that "the constraint signal is a hard step,
 *   ranking by degree of breach is impossible" — a false architectural
 *   conclusion that was written into the design plan. A missing signal must
 *   never silently render as a plausible value: hence
 *   `missing margin is DISTINGUISHABLE from a zero margin` below, which is
 *   the pin that would have caught it.
 *
 * PART 2 — the eligibility gate.
 *   `deriveRecommendedOption` is the SOLE producer of recommended_option_id
 *   (ISL ships none on the V2 wire). An option that positively breaches a
 *   stated constraint is never crowned; when NOTHING qualifies the response
 *   says so POSITIVELY via `robustness.recommendation_withheld` — never by
 *   omission, because the UI re-crowns its own argmax on a falsy
 *   recommended_option_id, so omission would deploy clean and enforce
 *   nothing.
 *
 * Eligibility is TRI-STATE and `unknown` NEVER coerces to either side; the
 * `unknown` case below is what makes that observable on the wire (a tri-state
 * that collapses to the same behaviour as a boolean is untestable theatre).
 *
 * Scenario mirrors the live staging probe (ISL build cdacb2f):
 *   constraint  fac_cost <= 50000, node cap 60000  → threshold normalises 0.8333
 *   opt_under     £38,000  prob_satisfied 1.0  no margin fields
 *   opt_just_over £52,000  prob_satisfied 0.0  margin 0.03333 (≈£2,000 over)
 *   opt_far_over  £82,000  prob_satisfied 0.0  margin 0.16667 (≈£10,000 over)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — per-option constraint_analysis + per-option win_probability
// ---------------------------------------------------------------------------

/** option_id → constraint_analysis (undefined entry = ISL sent none for it). */
let mockConstraintAnalysisByOption: Record<string, any> = {};
/** option_id → win_probability. */
let mockWinProbabilityByOption: Record<string, number> = {};
/** option_id → status ('computed' unless overridden). */
let mockStatusByOption: Record<string, string> = {};

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
    win_probability: mockWinProbabilityByOption[opt.id],
    status: mockStatusByOption[opt.id] ?? 'computed',
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

// ---------------------------------------------------------------------------
// Fixtures — mirror the live probe graph
// ---------------------------------------------------------------------------

/**
 * `fac_cost` carries an explicit `cap`, so its normalisation range is
 * [0, 60000] source `explicit_cap` — a PRODUCER-DECLARED scale. That keeps the
 * constraint target RELIABLE (no default-range fallback, no heuristic), so the
 * per-option probability fields this suite pins are DELIVERED rather than
 * suppressed by the producer-honesty gate.
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
  { id: 'opt_far_over', label: 'Far over budget', interventions: { fac_cost: 82000 } },
];

const CONSTRAINT_ID = 'c_cost_cap';
const GOAL_CONSTRAINTS = [
  { constraint_id: CONSTRAINT_ID, node_id: 'fac_cost', operator: '<=', value: 50000, label: 'First-year cost cap', unit: '£' },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

/** ISL constraint row for one option. Margin fields OMITTED when not supplied. */
function islConstraint(probSatisfied: number, margin?: number, nearMiss?: number) {
  return {
    constraints: [
      {
        node_id: 'fac_cost',
        operator: '<=',
        value: 50000,
        prob_satisfied: probSatisfied,
        ...(margin !== undefined && { failure_margin_median: margin }),
        ...(nearMiss !== undefined && { near_miss_fraction: nearMiss }),
      },
    ],
    joint_probability: probSatisfied,
  };
}

/** The live-probe shape: under passes with no margin, both over-budget breach. */
function setLiveProbeShape() {
  mockConstraintAnalysisByOption = {
    opt_under: islConstraint(1.0),
    opt_just_over: islConstraint(0.0, 0.03333, 1.0),
    opt_far_over: islConstraint(0.0, 0.16667, 0.0),
  };
}

async function runAnalysis(baseUrl: string, payload: object): Promise<any> {
  const res = await fetch(`${baseUrl}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
  return res.json();
}

function optionEntry(body: any, optionId: string): any {
  const entry = (body.option_comparison ?? []).find((o: any) => o.option_id === optionId);
  expect(entry, `option_comparison entry for ${optionId}`).toBeDefined();
  return entry;
}

// ---------------------------------------------------------------------------

describe('B4/L2 constraint eligibility gate + graded breach margins', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
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
  });

  beforeEach(() => {
    mockConstraintAnalysisByOption = {};
    mockWinProbabilityByOption = {};
    mockStatusByOption = {};
  });

  // =========================================================================
  // PART 1 — the graded signal reaches egress
  // =========================================================================

  describe('Part 1: ISL per-option graded breach signal reaches egress', () => {
    it('carries EACH option its OWN failure_margin_median / near_miss_fraction', async () => {
      setLiveProbeShape();
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      const justOver = optionEntry(body, 'opt_just_over').constraint_margins?.find(
        (m: any) => m.constraint_id === CONSTRAINT_ID,
      );
      const farOver = optionEntry(body, 'opt_far_over').constraint_margins?.find(
        (m: any) => m.constraint_id === CONSTRAINT_ID,
      );

      expect(justOver, 'opt_just_over must carry its own margin entry').toBeDefined();
      expect(farOver, 'opt_far_over must carry its own margin entry').toBeDefined();

      // Denormalised to user units by the constraint's range width (60000).
      expect(justOver.failure_margin_median).toBeCloseTo(2000, 0);
      expect(farOver.failure_margin_median).toBeCloseTo(10000, 0);
      expect(justOver.near_miss_fraction).toBe(1.0);
      expect(farOver.near_miss_fraction).toBe(0.0);

      // The whole point: the two breaching options are DISTINGUISHABLE, which
      // is what makes "ordered by how far over they are" possible at all.
      expect(farOver.failure_margin_median).toBeGreaterThan(justOver.failure_margin_median);

      // Sub-item 2: `approximate` is DERIVED from analysis_status (=== 'partial'),
      // not mirrored, and deliberately FALSE for failed/blocked (no usable answer).
      // This live-probe run is 'partial' → true; the golden pins the computed→false
      // case. Robust to golden regeneration.
      expect(body.approximate).toBe(body.analysis_status === 'partial');
    });

    it('a MISSING margin is DISTINGUISHABLE from a zero margin', async () => {
      // opt_under: ISL sent NO margin fields (it satisfies the constraint).
      // opt_just_over: ISL sent an explicit ZERO margin.
      // These two must NOT render identically. This is the pin for the defect
      // that fabricated positive evidence for a false conclusion.
      mockConstraintAnalysisByOption = {
        opt_under: islConstraint(1.0),
        opt_just_over: islConstraint(0.0, 0, 0),
        opt_far_over: islConstraint(0.0, 0.16667, 0.0),
      };
      mockWinProbabilityByOption = { opt_under: 0.5, opt_just_over: 0.3, opt_far_over: 0.2 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      const underMargin = optionEntry(body, 'opt_under').constraint_margins?.find(
        (m: any) => m.constraint_id === CONSTRAINT_ID,
      );
      const zeroMargin = optionEntry(body, 'opt_just_over').constraint_margins?.find(
        (m: any) => m.constraint_id === CONSTRAINT_ID,
      );

      expect(zeroMargin, 'explicit-zero option must carry a margin entry').toBeDefined();
      expect(underMargin, 'no-margin option must still carry its entry').toBeDefined();

      // A real measured zero is PRESENT and equal to 0 ...
      expect(zeroMargin).toHaveProperty('failure_margin_median');
      expect(zeroMargin.failure_margin_median).toBe(0);
      expect(zeroMargin).toHaveProperty('near_miss_fraction');
      expect(zeroMargin.near_miss_fraction).toBe(0);

      // ... while an ABSENT measurement is ABSENT, never a fabricated 0.
      expect(underMargin).not.toHaveProperty('failure_margin_median');
      expect(underMargin).not.toHaveProperty('near_miss_fraction');
      expect(underMargin.failure_margin_median).toBeUndefined();
    });

    it('marks a CLAMPED breach magnitude as a lower bound (Finding D)', async () => {
      // opt_far_over intervenes 82000 against a cap of 60000, so its
      // normalised value saturates at 1.0 and the reported £10,000 understates
      // the true £32,000 breach. The magnitude must be flagged, not stated.
      // opt_just_over (52000 < 60000) does NOT clamp, so its £2,000 is exact.
      setLiveProbeShape();
      mockWinProbabilityByOption = { opt_under: 0.5, opt_just_over: 0.3, opt_far_over: 0.2 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      const justOver = optionEntry(body, 'opt_just_over').constraint_margins[0];
      const farOver = optionEntry(body, 'opt_far_over').constraint_margins[0];

      expect(justOver.margin_precision).toBe('exact');
      expect(farOver.margin_precision).toBe('lower_bound');
    });
  });

  // =========================================================================
  // PART 2 — the eligibility gate
  // =========================================================================

  describe('Part 2: eligibility gate on recommended_option_id', () => {
    it.skip('DOCTRINE (unratified, b4 §6): an INFEASIBLE argmax leader is not crowned; the runner-up is', async () => {
      setLiveProbeShape();
      // opt_far_over is the argmax on win_probability but breaches the cap.
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      expect(body.robustness.recommended_option_id).toBe('opt_under');
      expect(body.robustness.recommended_option_label).toBe('Under budget');
      expect(body.robustness.recommendation_withheld).toBeUndefined();
    });

    it('MANDATORY POSITIVE CONTROL: when ALL options are feasible the argmax winner is STILL crowned', async () => {
      // Without this, a gate that rejects everything would look correct.
      mockConstraintAnalysisByOption = {
        opt_under: islConstraint(1.0),
        opt_just_over: islConstraint(1.0),
        opt_far_over: islConstraint(1.0),
      };
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      expect(body.robustness.recommended_option_id).toBe('opt_far_over');
      expect(body.robustness.recommendation_withheld).toBeUndefined();
    });

    it('POSITIVE CONTROL: with NO constraints sent the argmax winner is crowned unchanged', async () => {
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, BASE_PAYLOAD);

      expect(body.robustness.recommended_option_id).toBe('opt_far_over');
      expect(body.robustness.recommendation_withheld).toBeUndefined();
    });

    it.skip('DOCTRINE (unratified, b4 §6): NOTHING QUALIFIES — no crown, and a POSITIVE recommendation_withheld (never omission)', async () => {
      mockConstraintAnalysisByOption = {
        opt_under: islConstraint(0.0, 0.05, 0.5),
        opt_just_over: islConstraint(0.0, 0.03333, 1.0),
        opt_far_over: islConstraint(0.0, 0.16667, 0.0),
      };
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      expect(body.robustness.recommended_option_id).toBeUndefined();
      expect(body.robustness.recommended_option_label).toBeUndefined();

      const withheld = body.robustness.recommendation_withheld;
      expect(withheld, 'withheld must be POSITIVE — the UI backfills its own argmax on absence').toBeDefined();
      expect(withheld.reason).toBe('no_eligible_option');
      expect(withheld.constraint_id).toBe(CONSTRAINT_ID);
      expect(withheld.label).toBe('First-year cost cap');
      expect(withheld.value).toBe(50000);
      expect(withheld.unit).toBe('£');

      // Option A ordering data: closest-first. opt_just_over is least over.
      expect(withheld.closest_option_id).toBe('opt_just_over');
      expect(withheld.closest_gap).toBeCloseTo(2000, 0);
      expect(withheld.closest_gap_precision).toBe('exact');
    });

    it.skip('DOCTRINE (unratified, b4 §6): TRI-STATE — an option with UNKNOWN eligibility is neither crowned-as-verified nor filtered out', async () => {
      // opt_under gets NO constraint_analysis from ISL → eligibility unknown.
      // Both other options positively breach. The unknown option must survive
      // the filter (we have no evidence it breaches) but must NOT be reported
      // as verified-eligible.
      mockConstraintAnalysisByOption = {
        opt_just_over: islConstraint(0.0, 0.03333, 1.0),
        opt_far_over: islConstraint(0.0, 0.16667, 0.0),
      };
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      expect(body.robustness.recommended_option_id).toBe('opt_under');
      // `unknown` must NOT be coerced to 'eligible'.
      expect(body.robustness.recommended_option_eligibility).toBe('unknown');
      expect(body.robustness.recommendation_withheld).toBeUndefined();
    });

    // DEFERRED: crowning-adjacent (deriveRecommendedOption status filter); not in A1's GO list; rides UI-first deploy order — follow-on lane.
    it.skip('STATUS PARITY with computeNearTie: a non-computed option is never crowned', async () => {
      mockConstraintAnalysisByOption = {
        opt_under: islConstraint(1.0),
        opt_just_over: islConstraint(1.0),
        opt_far_over: islConstraint(1.0),
      };
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.9 };
      mockStatusByOption = { opt_far_over: 'error' };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      expect(body.robustness.recommended_option_id).toBe('opt_just_over');
    });

    it.skip('DOCTRINE (unratified, b4 §6): per-option constraint_eligibility is emitted on every option_comparison entry', async () => {
      setLiveProbeShape();
      mockWinProbabilityByOption = { opt_under: 0.2, opt_just_over: 0.3, opt_far_over: 0.5 };

      const body = await runAnalysis(baseUrl, { ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });

      expect(optionEntry(body, 'opt_under').constraint_eligibility).toBe('eligible');
      expect(optionEntry(body, 'opt_just_over').constraint_eligibility).toBe('ineligible');
      expect(optionEntry(body, 'opt_far_over').constraint_eligibility).toBe('ineligible');
    });
  });

  // =========================================================================
  // PART 3 — goal_constraints ingress-shape guard (sub-item 4)
  // =========================================================================
  // The runV3 body JSON-schema types goal_constraints only as an array of
  // objects (inner fields UNVALIDATED). PLoT reads c.constraint_id / c.node_id
  // everywhere downstream (id resolver, constraint-trace log, constraint
  // mapping); an entry missing either as a non-empty string silently corrupts
  // identity/targeting. The guard rejects it at the boundary with a 422 blocked
  // response BEFORE any of that runs. These are the RED-first pins for that
  // guard (a fix with no test that proves it bites is untested theatre).
  describe('Part 3: goal_constraints ingress-shape guard', () => {
    async function postRun(payload: object): Promise<{ status: number; body: any }> {
      const res = await fetch(`${baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: res.status, body: await res.json() };
    }

    it('POSITIVE CONTROL: a well-formed constraint is NOT blocked (200)', async () => {
      setLiveProbeShape();
      mockWinProbabilityByOption = { opt_under: 0.5, opt_just_over: 0.3, opt_far_over: 0.2 };
      const { status } = await postRun({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
      expect(status).toBe(200);
    });

    it('rejects a MISSING constraint_id with 422 naming goal_constraints[0].constraint_id', async () => {
      const { status, body } = await postRun({
        ...BASE_PAYLOAD,
        goal_constraints: [{ node_id: 'fac_cost', operator: '<=', value: 50000 }],
      });
      expect(status).toBe(422);
      const s = JSON.stringify(body);
      expect(s).toContain('INVALID_CONSTRAINT_SHAPE');
      expect(s).toContain('goal_constraints[0].constraint_id');
    });

    it('rejects an EMPTY-STRING node_id with 422 naming the field + index', async () => {
      const { status, body } = await postRun({
        ...BASE_PAYLOAD,
        goal_constraints: [
          { constraint_id: 'c_ok', node_id: 'fac_cost', operator: '<=', value: 50000 },
          { constraint_id: 'c_bad', node_id: '', operator: '<=', value: 50000 },
        ],
      });
      expect(status).toBe(422);
      const s = JSON.stringify(body);
      expect(s).toContain('INVALID_CONSTRAINT_SHAPE');
      expect(s).toContain('goal_constraints[1].node_id');
    });

    it('rejects a NON-STRING constraint_id with 422', async () => {
      const { status, body } = await postRun({
        ...BASE_PAYLOAD,
        goal_constraints: [{ constraint_id: 123, node_id: 'fac_cost', operator: '<=', value: 50000 }],
      });
      expect(status).toBe(422);
      expect(JSON.stringify(body)).toContain('goal_constraints[0].constraint_id');
    });
  });
});
