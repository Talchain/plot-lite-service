/**
 * THE PRODUCT PRESCRIBED A REMEDY THAT CANNOT WORK — L63-only message, non-root
 * target. Measured on a live journey against deployed CEE `0168483`, 18 Sep 2026.
 *
 * WHAT THE USER WAS TOLD, verbatim, inside an `inference_warnings` entry coded
 * `CONSTRAINT_TARGET_UNRELIABLE`:
 *
 *     "Set a current value for "We Want It Under 2.5%" — or state the target as
 *      the change you want from today — to make it comparable."
 *
 * The user did exactly that. Measured on the following turn: `graph_hash`
 * UNCHANGED · ZERO `graph_patch` blocks · `win_probabilities` BYTE-IDENTICAL ·
 * the same warning repeated.
 *
 * ⭐ THE REFUTATION THAT NEEDS NO CODE READING. The other witnessed target,
 * "Runway Remaining", ALREADY carried `observed_state {value: 0.7, raw_value:
 * 14, unit: 'months'}` and `display_value "14 months"` — and still received
 * "Set a current value for Runway Remaining". The remedy was already satisfied
 * before the sentence was written. That is the shape T1/T3 below reproduce.
 *
 * WHY IT IS IMPOSSIBLE, NOT BROKEN — both limbs are dead for this shape:
 *
 *   Limb 1 "set a current value" — `resolveConstraintSampleFrameAnchor` returns
 *   at `if (directedEdgeTargets.has(nodeId)) return null` BEFORE the
 *   `root_observed_level` limb, so for any target with >=1 directed incoming
 *   edge it never reads `observed_state`. On the live graph the goal node had
 *   4 directed incoming edges and "Runway Remaining" had 2.
 *
 *   Limb 2 "state the target as the change you want from today" — needs
 *   `goal_threshold_frame === 'delta'`. In CEE `CEE_GOAL_THRESHOLD_FRAME =
 *   'level'` is a code constant, all three non-test writers assign it, and the
 *   field is in CEE_MINTED_GOAL_FIELDS ("the fields no model may author"),
 *   stripped at ingress. Zero writers of 'delta' exist.
 *
 * SO THE NON-ROOT ARM PRESCRIBES NEITHER. It states what is true and stops.
 *
 * ⭐ AND THE OPPOSITE-DIRECTION TWIN IS THE POINT OF T2/T4. Closing this by
 * suppressing the advice EVERYWHERE would be the failure mode: for a ROOT
 * target "set a current value" genuinely resolves `root_observed_level`. The
 * root arm must keep it. A fix that reds T1 and T2 together has not discriminated
 * root from non-root — it has just gone quiet.
 *
 * BINDING BY IDENTITY, not by a value predicate: every wire assertion locates
 * its warning by the target node's exact LABEL, so a sibling warning about a
 * different node cannot satisfy it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildConstraintTargetUnreliableMessage,
  resolveConstraintSampleFrameAnchor,
  collectDirectedEdgeTargets,
} from '../src/lib/constraint-reliability.js';

// The exact sentence fragment the live journey delivered. Not paraphrased.
const IMPOSSIBLE_REMEDY = 'Set a current value for';
const DEAD_DELTA_LIMB = 'the change you want from today';

// ---------------------------------------------------------------------------
// UNIT — the RENDERED STRING, both arms.
// ---------------------------------------------------------------------------
describe('L63-only message — the prescribed remedy is gated on PROVED root-ness', () => {
  /**
   * PRECONDITION PIN, in-test. Without it every assertion below could pass on a
   * builder that had collapsed into one generic string, or on a resolver that
   * had stopped discriminating. Asserts the RESOLVER really does answer
   * differently for the two shapes this spec is about — so the message
   * assertions are provably about the code's behaviour and not the fixture's.
   */
  it('T0 PRECONDITION: the resolver refuses a non-root WITH an observed value, and admits a root that gains one', () => {
    const nodes = [
      // The live "Runway Remaining" shape: a value is already present.
      { id: 'runway', observed_state: { value: 0.7 } },
      { id: 'burn', observed_state: { value: 0.3 } },
      { id: 'headcount' },
    ];
    const directed = collectDirectedEdgeTargets([{ from: 'burn', to: 'runway' }]);

    // Non-root, value ALREADY SET -> still refused. This is the refutation.
    expect(directed.has('runway')).toBe(true);
    expect(
      resolveConstraintSampleFrameAnchor('runway', nodes, directed, [], undefined),
    ).toBeNull();

    // Root with NO value -> refused (this is the shape that reaches the L63
    // message), and the SAME root once given a value -> ADMITTED. That pair is
    // what makes "set a current value" a working remedy for a root and an inert
    // one for a non-root, and it is the whole basis of the two arms below.
    expect(directed.has('headcount')).toBe(false);
    expect(
      resolveConstraintSampleFrameAnchor('headcount', nodes, directed, [], undefined),
    ).toBeNull();

    const nodesWithHeadcountValue = nodes.map((n) =>
      n.id === 'headcount' ? { id: 'headcount', observed_state: { value: 0.55 } } : n,
    );
    expect(
      resolveConstraintSampleFrameAnchor('headcount', nodesWithHeadcountValue, directed, [], undefined),
    ).toBe('root_observed_level');

    // ...and doing the same to the NON-root changes nothing. It already had a
    // value; giving it another one is still refused.
    expect(
      resolveConstraintSampleFrameAnchor('runway', nodesWithHeadcountValue, directed, [], undefined),
    ).toBeNull();
  });

  /**
   * T1 — THE DEFECT. A non-root target must not be sent to perform an edit the
   * resolver provably ignores.
   */
  it('T1 DEFECT: a NON-ROOT target is not told to set a current value', () => {
    const msg = buildConstraintTargetUnreliableMessage(
      'Runway Remaining',
      ['sample_frame_unanchored'],
      undefined,
      false, // proved NON-root
    );

    expect(msg).not.toContain(IMPOSSIBLE_REMEDY);
    // The second limb is unactionable through CEE too, so it must not be the
    // substitute prescription.
    expect(msg).not.toContain(DEAD_DELTA_LIMB);

    // It must still be a real, honest refusal rather than silence.
    expect(msg).toContain('Runway Remaining');
    expect(msg).toContain('withheld');
    expect(msg).toContain('recorded');
    expect(msg).not.toMatch(/\d+(\.\d+)?\s*%/);
  });

  /**
   * ⭐ T2 — THE OPPOSITE-DIRECTION TWIN. Proves the fix DISCRIMINATES rather
   * than suppressing everywhere. For a root the remedy resolves
   * `root_observed_level`, so it is kept.
   */
  it('T2 TWIN: a ROOT target IS still told to set a current value', () => {
    const msg = buildConstraintTargetUnreliableMessage(
      'Headcount',
      ['sample_frame_unanchored'],
      undefined,
      true, // proved root
    );

    expect(msg).toContain(IMPOSSIBLE_REMEDY);
    expect(msg).toContain('Headcount');
    expect(msg).toContain('withheld');
    expect(msg).not.toMatch(/\d+(\.\d+)?\s*%/);

    // A root has no parents, so the non-root diagnosis would be FALSE here.
    expect(msg).not.toContain('calculated from the factors feeding into it');
  });

  /**
   * The two arms are genuinely different texts. Without this, T1 and T2 could
   * both pass on a builder that had stopped reading the flag at all only if the
   * fragments happened to co-occur — this closes that off explicitly.
   */
  it('T2b: the two arms are different messages, not one string', () => {
    const root = buildConstraintTargetUnreliableMessage('X', ['sample_frame_unanchored'], undefined, true);
    const nonRoot = buildConstraintTargetUnreliableMessage('X', ['sample_frame_unanchored'], undefined, false);
    expect(root).not.toBe(nonRoot);
  });

  /**
   * FAIL CLOSED on an unproved caller: no root-ness argument means no proof,
   * and an unproved remedy is not prescribed. Withholding advice from a root
   * costs a suggestion; offering it to a non-root sends the user to do
   * something inert — the two directions are not symmetric.
   */
  it('T2c: an UNPROVED caller gets the non-prescribing arm', () => {
    const msg = buildConstraintTargetUnreliableMessage('X', ['sample_frame_unanchored']);
    expect(msg).not.toContain(IMPOSSIBLE_REMEDY);
    expect(msg).toBe(
      buildConstraintTargetUnreliableMessage('X', ['sample_frame_unanchored'], undefined, false),
    );
  });

  /**
   * The both-reasons message is a DIFFERENT authority with its own domain and
   * its own already-shipped decision. Pinned here so this change is provably
   * scoped to the L63-only branch and did not reach into its sibling.
   */
  it('T2d: the BOTH-REASONS message is untouched by the root-ness flag', () => {
    const a = buildConstraintTargetUnreliableMessage(
      'AE Attrition Risk',
      ['sample_frame_unanchored', 'constraint_unit_mismatch'],
      { constraint_unit: 'count', scale_unit: '%' },
      false,
    );
    const b = buildConstraintTargetUnreliableMessage(
      'AE Attrition Risk',
      ['sample_frame_unanchored', 'constraint_unit_mismatch'],
      { constraint_unit: 'count', scale_unit: '%' },
      true,
    );
    expect(a).toBe(b);
    expect(a).not.toContain(IMPOSSIBLE_REMEDY);
  });
});

// ---------------------------------------------------------------------------
// WIRE — the rendered string as it reaches inference_warnings.
// A unit-level pin proves the builder; only this proves the USER's sentence.
// ---------------------------------------------------------------------------
let capturedISLRequestBody: any = null;

function mockResultRows(body: any) {
  const options = body.options || [];
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    constraint_analysis: {
      probability_of_joint_goal: 0.31,
      constraint_probabilities: Object.fromEntries(
        (body.goal_constraints || []).map((c: any) => [c.constraint_id, 0.0054]),
      ),
    },
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: {
          mean: 0.2915, std: 0.2048, p10: 0.05, p50: 0.294, p90: 0.555,
          n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
        },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = body;
    return {
      data: {
        options: mockResultRows(body),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

/**
 * `runway` reproduces the witnessed shape: a NON-root (one directed parent)
 * that ALREADY carries an observed value. `headcount` is its root twin, with no
 * observed value, so the same L63 reason fires for the opposite topology.
 * Neither is pinned by every option — the options intervene only on `coaching`.
 */
function wireGraph() {
  return {
    nodes: [
      { id: 'goal_arr', kind: 'goal', label: 'Grow ARR' },
      {
        id: 'runway', kind: 'factor', label: 'Runway Remaining',
        observed_state: { value: 0.7, raw_value: 14, unit: 'months' },
      },
      { id: 'burn', kind: 'factor', label: 'Burn rate', observed_state: { value: 0.3 } },
      { id: 'headcount', kind: 'factor', label: 'Headcount' },
      { id: 'coaching', kind: 'factor', label: 'Coaching spend', observed_state: { value: 0.4 } },
    ],
    edges: [
      { from: 'burn', to: 'runway', exists_probability: 0.9, strength: { mean: -0.4, std: 0.1 } },
      { from: 'runway', to: 'goal_arr', exists_probability: 0.9, strength: { mean: 0.4, std: 0.1 } },
      { from: 'headcount', to: 'goal_arr', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      { from: 'coaching', to: 'goal_arr', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

const WIRE_OPTIONS = [
  { id: 'opt_a', label: 'A', interventions: { coaching: { value: 0.7, source: 'user_specified' } } },
  { id: 'opt_b', label: 'B', interventions: { coaching: { value: 0.5, source: 'user_specified' } } },
];

describe('WIRE — the CONSTRAINT_TARGET_UNRELIABLE sentence the user actually reads', () => {
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
    capturedISLRequestBody = null;
  });

  async function run(goalConstraints: unknown[]) {
    capturedISLRequestBody = null;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      payload: {
        graph: wireGraph(),
        options: WIRE_OPTIONS,
        goal_node_id: 'goal_arr',
        seed: 'l63-root-remedy',
        n_samples: 2000,
        goal_constraints: goalConstraints,
      },
    });
    return { res, body: res.json() as any };
  }

  // Binds by the node's exact LABEL, so a sibling warning cannot satisfy it.
  function warningFor(body: any, label: string): any | undefined {
    return (body.inference_warnings ?? []).find(
      (w: any) => w.code === 'CONSTRAINT_TARGET_UNRELIABLE' && String(w.message).includes(label),
    );
  }

  /**
   * T3 — THE WITNESSED SHAPE, at the wire. A non-root target that ALREADY has a
   * current value must not be told to set one.
   */
  it('T3 DEFECT at the wire: the NON-ROOT target is not told to set a current value', async () => {
    const { res, body } = await run([
      {
        constraint_id: 'gc_runway', node_id: 'runway',
        operator: '>=', value: 0.5, label: 'Keep runway above 9 months',
      },
    ]);

    expect(res.statusCode).toBe(200);

    const w = warningFor(body, 'Runway Remaining');
    // PRECONDITION: the warning must EXIST, or every "not contains" below is
    // vacuous — an absence probe with nothing to be absent from.
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');

    expect(w.message).not.toContain(IMPOSSIBLE_REMEDY);
    expect(w.message).not.toContain(DEAD_DELTA_LIMB);
    expect(w.message).toContain('withheld');
    expect(w.message).toContain('recorded');
  });

  /**
   * ⭐ T4 — THE WIRE TWIN. Same run shape, ROOT target, and the advice survives.
   * If T3 passes and T4 fails, the fix suppressed everywhere.
   */
  it('T4 TWIN at the wire: the ROOT target IS still told to set a current value', async () => {
    const { res, body } = await run([
      {
        constraint_id: 'gc_headcount', node_id: 'headcount',
        operator: '>=', value: 0.5, label: 'Keep headcount up',
      },
    ]);

    expect(res.statusCode).toBe(200);

    const w = warningFor(body, 'Headcount');
    expect(w).toBeDefined();
    expect(w.severity).toBe('warning');
    expect(w.message).toContain(IMPOSSIBLE_REMEDY);
  });

  /**
   * T5 — both in ONE run, which is the only form that proves the discrimination
   * is per-NODE rather than per-request. A per-request flag would make T3 and T4
   * pass separately and fail here.
   */
  it('T5 DISCRIMINATION: in a single run, the root gets the advice and the non-root does not', async () => {
    const { res, body } = await run([
      { constraint_id: 'gc_runway', node_id: 'runway', operator: '>=', value: 0.5, label: 'Runway' },
      { constraint_id: 'gc_headcount', node_id: 'headcount', operator: '>=', value: 0.5, label: 'Headcount' },
    ]);

    expect(res.statusCode).toBe(200);

    const nonRoot = warningFor(body, 'Runway Remaining');
    const root = warningFor(body, 'Headcount');
    expect(nonRoot).toBeDefined();
    expect(root).toBeDefined();
    expect(nonRoot.message).not.toBe(root.message);

    expect(root.message).toContain(IMPOSSIBLE_REMEDY);
    expect(nonRoot.message).not.toContain(IMPOSSIBLE_REMEDY);
  });
});
