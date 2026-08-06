/**
 * ROADMAP 2.744 — per-option `status` honesty on the live /v2/run path
 * ----------------------------------------------------------------------------
 * RED-first. Every `it` below FAILS at pristine `a825a789`, because PLoT
 * branched on a per-option status vocabulary ISL cannot emit.
 *
 * THE ORACLE IS THE PRODUCER, NOT THIS FILE'S OPINION (trap 13c — a mutant kit
 * validates sensitivity, never correctness; a perfect kill-rate against a wrong
 * expectation is a perfect score on the wrong exam). Every expectation here is
 * derived from ISL's `determine_option_status(n_valid, n_total)`
 * (src/utils/response_builder.py) and `_determine_analysis_status()` in the
 * same file:
 *
 *   failed   ⇔ n_valid === 0            → NO finite samples. A real failure.
 *   partial  ⇔ 0 < ratio < 0.8          → a DISCLOSURE. ISL still emits a full
 *                                         `outcome` block and raises
 *                                         LOW_EFFECTIVE_SAMPLES. NOT an error.
 *   computed ⇔ ratio >= 0.8
 *
 * and, for the envelope:
 *
 *   all options computed          → analysis_status 'computed'
 *   SOME (not all) computed       → analysis_status 'partial'
 *   none computed                 → analysis_status 'failed'
 *
 * That last rule is why the run-status case below is not a judgement call:
 * with one failed and one computed option, ISL ITSELF declares the run
 * 'partial'. PLoT reported 'failed'. The honest answer was already on the wire
 * and PLoT was discarding it.
 *
 * The `partial`-shaped cases are the DISCRIMINATING half of the kit: they prove
 * the fix binds to `'failed'` by identity rather than to "any status that is
 * not 'computed'", which would have been an equally green and equally wrong
 * substitution.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import {
  makeOptionResultV2,
  finiteOutcome,
  islOptionStatusValues,
} from './helpers/isl-option-fixture.js';

// ---------------------------------------------------------------------------
// Mocked ISL. Per-test control of the exact V2 envelope + option array.
// ---------------------------------------------------------------------------

let mockOptions: any[] | undefined;
let mockAnalysisStatus: string | undefined;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, _body: any): Promise<{ data: T | null; error: string | null }> {
    return {
      data: {
        // Envelope. `analysis_status` is ISL's own verdict on the run and is
        // set per-test to whatever ISL's _determine_analysis_status() would
        // return for the option array below — never to a convenient value.
        analysis_status: mockAnalysisStatus ?? 'computed',
        robustness_status: 'computed',
        factor_sensitivity_status: 'computed',
        options: mockOptions ?? [],
        // ⚠ LOAD-BEARING, DO NOT TRIM. The robustness block must be FULLY
        // populated so that robustness_status AND drivers_status both resolve
        // to 'computed'. Otherwise determineTopLevelStatus returns 'partial'
        // because a SECONDARY feature is missing, and the headline test below
        // would pass without the option-status fix doing any work at all —
        // a guard agreeing with itself (root CLAUDE.md trap 13b). Shape
        // derived from RobustnessResultV2 / EdgeSensitivityV2 in the vendored
        // ISL OpenAPI (required fields only, plus edge_sensitivity).
        robustness: {
          level: 'high',
          confidence: 0.9,
          edge_sensitivity: [{
            edge_id: 'factor-a->goal',
            from_id: 'factor-a',
            to_id: 'goal',
            sensitivity_type: 'strength',
            sensitivity_score: 0.42,
            direction: 'positive',
            elasticity: 0.5,
            importance_rank: 1,
            interpretation: 'Market Size drives Revenue',
          }],
          fragile_edges: [],
          robust_edges: [],
        },
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

const BASE_PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', goal_threshold_frame: 'delta', label: 'Revenue', observed_state: { value: 40000 } },
      { id: 'factor-a', kind: 'factor', label: 'Market Size' },
    ],
    edges: [{ from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
  },
  options: [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
    { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 2.0 } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

const GOAL_CONSTRAINTS = [
  { constraint_id: 'revenue-min', node_id: 'goal', operator: '>=', value: 20000 },
];

const CONSTRAINT_PAYLOAD = {
  constraints: [{ node_id: 'goal', operator: '>=', value: 20000, prob_satisfied: 0.85 }],
};

describe('ROADMAP 2.744 · per-option status is read with ISL\'s own vocabulary', () => {
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
    mockOptions = undefined;
    mockAnalysisStatus = undefined;
  });

  async function run(payload: any) {
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('PRECONDITION: the producer really does emit failed/partial/computed and nothing else', () => {
    // Pins the discriminating power of every case below. If ISL's enum ever
    // changes, these tests must be re-derived rather than quietly continuing to
    // assert against a vocabulary the producer abandoned (trap 13b).
    expect(islOptionStatusValues().sort()).toEqual(['computed', 'failed', 'partial']);
  });

  // -------------------------------------------------------------------------
  // 1. The revived guard: hasOptionError must be able to FIRE.
  // -------------------------------------------------------------------------

  it('RED@pristine · a FAILED option with no constraint payload ⇒ constraints_status "error", not "unavailable"', async () => {
    // ISL was asked for constraints; opt1 failed (n_valid === 0) and opt2
    // computed but carries no constraint_analysis, so no constraint
    // probabilities came back at all. The user must be told the upstream
    // ERRORED, not handed the softer 'unavailable' that reads as "nothing to
    // say". At pristine `hasOptionError` tested for status === 'error', which
    // ISL cannot emit, so this returned 'unavailable' every time.
    //
    // ⚠ REACHABILITY, derived rather than assumed (trap 16's inverse: a live
    // code path the producer cannot feed is not a live path). The envelope MUST
    // be 'partial' here. ISL's _determine_analysis_status() returns 'failed'
    // when NO option computed, and run.ts short-circuits an ISL 'failed'
    // envelope into buildV2RunError long before buildConstraintFields is
    // reached. So the ONLY envelope under which this guard can fire is
    // 'partial' — some options computed, at least one failed. An earlier draft
    // of this test used 'failed' and was testing a combination the producer
    // cannot deliver.
    mockAnalysisStatus = 'partial';
    mockOptions = [
      makeOptionResultV2({ id: 'opt1', outcome: finiteOutcome(0.7), status: 'failed' }),
      makeOptionResultV2({ id: 'opt2', outcome: finiteOutcome(0.8), status: 'computed' }),
    ];
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('error');
    expect(body.constraint_results).toBeUndefined();
  });

  it('DISCRIMINATOR · a PARTIAL option with no constraint payload ⇒ "unavailable", NOT "error"', async () => {
    // The other half of the pair, and the one that proves the fix binds to
    // 'failed' by IDENTITY rather than to "not computed". Producer semantics:
    // `partial` means 0 < valid/total < 0.8 — samples EXIST, ISL can and does
    // compute constraint probabilities from them, and it raises
    // LOW_EFFECTIVE_SAMPLES as a disclosure. So an absent constraint payload
    // alongside `partial` was NOT caused by the option being partial, and
    // calling it an upstream error would attribute a fault ISL never reported.
    mockAnalysisStatus = 'partial';
    mockOptions = [
      makeOptionResultV2({ id: 'opt1', outcome: finiteOutcome(0.7), status: 'partial' }),
      makeOptionResultV2({ id: 'opt2', outcome: finiteOutcome(0.8), status: 'computed' }),
    ];
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('unavailable');
  });

  it('RED@pristine · a constraint-BEARING option that FAILED ⇒ "error" (its probabilities rest on zero samples)', async () => {
    // The rarer shape at run.ts's second guard: the option carries a
    // constraint payload but reports `failed`. n_valid === 0 means those
    // probabilities were computed from nothing, so the payload must not be
    // served as 'computed'.
    //
    // ⚠ HONEST SCOPE. Unlike the case above, I did NOT establish that ISL
    // emits this combination: its constraint_analysis conversion is
    // independent of status (`if result.constraint_analysis:`), so a failed
    // option carrying a payload is possible in principle, but no producer path
    // was traced that actually does it. This guard is therefore DEFENSIVE, and
    // is documented as such rather than dressed up as a witnessed wire. The
    // envelope is 'partial' for the reachability reason given above.
    mockAnalysisStatus = 'partial';
    mockOptions = [
      makeOptionResultV2({
        id: 'opt1', outcome: finiteOutcome(0.7), status: 'failed',
        constraint_analysis: CONSTRAINT_PAYLOAD,
      }),
      makeOptionResultV2({ id: 'opt2', outcome: finiteOutcome(0.8), status: 'computed' }),
    ];
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('error');
  });

  it('DISCRIMINATOR · a constraint-BEARING option that is PARTIAL still reports "computed"', async () => {
    // `partial` carries real samples and a real constraint payload. Reporting
    // 'error' here would DISCARD constraint results ISL honestly computed —
    // the opposite failure from the one being fixed, and exactly what a
    // careless "treat everything non-computed as an error" substitution does.
    mockAnalysisStatus = 'partial';
    mockOptions = [
      makeOptionResultV2({
        id: 'opt1', outcome: finiteOutcome(0.7), status: 'partial',
        constraint_analysis: CONSTRAINT_PAYLOAD,
      }),
      makeOptionResultV2({ id: 'opt2', outcome: finiteOutcome(0.8), status: 'computed' }),
    ];
    const { status, body } = await run({ ...BASE_PAYLOAD, goal_constraints: GOAL_CONSTRAINTS });
    expect(status).toBe(200);
    expect(body.constraints_status).toBe('computed');
    expect(body.constraint_results).toHaveLength(1);
    expect(body.constraint_results[0].probability).toBe(0.85);
  });

  // -------------------------------------------------------------------------
  // 2. One failed option must not condemn the whole run.
  // -------------------------------------------------------------------------

  it('RED@pristine · one FAILED option + one COMPUTED option ⇒ the run is "partial", not "failed"', async () => {
    // THE HEADLINE DEFECT. opt1 failed with no usable outcome stats; opt2
    // computed cleanly. At pristine the usability exemption listed only
    // 'skipped'/'error', so opt1 was neither exempt nor usable,
    // hasUsableOptionComparison collapsed to false for the WHOLE run, and
    // determineTopLevelStatus returned 'failed' — throwing away a perfectly
    // good comparison the user could have acted on.
    //
    // The expected verdict is NOT this test's invention: ISL's
    // _determine_analysis_status() returns 'partial' for exactly this array
    // (some but not all options computed), and says so on the wire.
    mockAnalysisStatus = 'partial';
    mockOptions = [
      // n_valid === 0: no distribution at all. Outcome stats absent, which is
      // why the usability predicate cannot save it.
      makeOptionResultV2({ id: 'opt1', status: 'failed', outcome: {} }),
      makeOptionResultV2({ id: 'opt2', status: 'computed', outcome: finiteOutcome(0.8) }),
    ];
    const { status, body } = await run(BASE_PAYLOAD);
    expect(status).toBe(200);
    // The usable comparison survives...
    expect(body.option_comparison_status).toBe('computed');
    // ...but the run is honestly flagged as approximate, matching ISL.
    expect(body.analysis_status).toBe('partial');
    expect(body.approximate).toBe(true);

    // PIN THE PRECONDITION (trap 13b). 'partial' has two possible causes here:
    // a degraded SECONDARY feature, or the option-level clamp this lane added.
    // Assert both secondary features computed, so the only remaining
    // explanation for 'partial' is the option status — otherwise this test
    // would keep passing after the fix was reverted, for the wrong reason.
    expect(body.robustness_status).toBe('computed');
    expect(body.drivers_status).toBe('computed');
  });

  it('a run where ALL options computed is still reported "computed" (the fix does not blanket-downgrade)', async () => {
    // Guards the opposite over-correction: clamping to ISL's envelope must not
    // make every run look degraded.
    mockAnalysisStatus = 'computed';
    mockOptions = [
      makeOptionResultV2({ id: 'opt1', status: 'computed', outcome: finiteOutcome(0.7) }),
      makeOptionResultV2({ id: 'opt2', status: 'computed', outcome: finiteOutcome(0.8) }),
    ];
    const { status, body } = await run(BASE_PAYLOAD);
    expect(status).toBe(200);
    expect(body.option_comparison_status).toBe('computed');
    expect(body.approximate).toBe(false);
    expect(body.analysis_status).not.toBe('failed');
  });

  it('a COMPUTED option with an omitted outcome still degrades the run (the exemption is not an amnesty)', async () => {
    // Found by a SURVIVING MUTANT, not by design: replacing the exemption
    // predicate with `return true` left every other test in this file green.
    // That mutant is NOT equivalent — it breaks the exact property the
    // exemption clause exists to protect, stated in run.ts's own comment:
    // "'computed' cannot be reported when a computed option's outcome was
    // omitted". Nothing pinned it, so the fix could have been widened into a
    // blanket amnesty with no red anywhere.
    //
    // opt2 claims 'computed' but carries no usable outcome stats. It is NOT
    // exempt (ISL declared it fully computed), so it must drag the run down
    // rather than be waved through.
    //
    // ⚠ Scope: PLoT-side property. ISL emitting 'computed' with non-finite
    // outcome stats was not traced to a producer path; this guards PLoT's own
    // numeric-egress behaviour, and is defensive by intent.
    mockAnalysisStatus = 'computed';
    mockOptions = [
      makeOptionResultV2({ id: 'opt1', status: 'computed', outcome: finiteOutcome(0.8) }),
      makeOptionResultV2({ id: 'opt2', status: 'computed', outcome: {} }),
    ];
    const { status, body } = await run(BASE_PAYLOAD);
    expect(status).toBe(200);
    expect(body.option_comparison_status).not.toBe('computed');
    expect(body.analysis_status).toBe('failed');
  });

  it('a run with NO usable option outcomes is still "failed" (usability remains the floor)', async () => {
    // The exemption must not become a blanket amnesty: if EVERY option failed,
    // there is no primary deliverable and the run really has failed. This is
    // the case the exemption list must NOT swallow.
    mockAnalysisStatus = 'partial'; // deliberately generous envelope
    mockOptions = [
      makeOptionResultV2({ id: 'opt1', status: 'failed', outcome: {} }),
      makeOptionResultV2({ id: 'opt2', status: 'failed', outcome: {} }),
    ];
    const { status, body } = await run(BASE_PAYLOAD);
    expect(status).toBe(200);
    expect(body.analysis_status).toBe('failed');
  });
});
