/**
 * ROADMAP 2.449 — DOWNSIDE / TAIL-RISK PLUMBING (the SURFACING leg at PLoT).
 * ---------------------------------------------------------------------------
 * THE GAP THIS SUITE PINS. ISL has emitted `options[].downside{cvar_10, p05,
 * expected_regret}` since #91/#92 (hardened by #124/#125). PLoT's
 * `option_comparison` builder (routes/v2/run.ts) constructs each entry by
 * EXPLICIT FIELD SELECTION and never reads `r.downside`, so the block died one
 * hop after the engine that computed it. Derived at the bytes, not assumed:
 *
 *   · `rg -nai 'cvar' src/` at staging tip e18e17c2 → ZERO hits.
 *   · Live UI-facing turn capture (4 Aug 2026,
 *     DecisionGuideAI `src/v5/__tests__/fixtures/live-analysis-turn-walkA-2026-08-04.json`)
 *     carries `decision_evpi` and per-option keys exactly
 *     {id, label, option_id, option_label, outcome, probability_of_goal, status,
 *     win_probability} — PLoT's builder output, with no downside.
 *   · It is a DROP, not a never-emitted: ISL's own model validator
 *     `_decision_evpi_matches_regret_population` (src/models/response_v2.py)
 *     RAISES when `decision_evpi` is present and no option carries
 *     `downside.expected_regret`. `decision_evpi` is present in that capture,
 *     so ISL emitted downside blocks on that very run.
 *
 * PRODUCER-DERIVED SEMANTICS (read from ISL's `DownsideV2`, response_v2.py, at
 * ISL staging 88275e5c — NOT from this lane's reading of what the fields ought
 * to mean, trap 13c):
 *   · cvar_10        mean of the WORST 10% of post-noise outcome samples.
 *                    Guaranteed <= outcome.p10. Tail mass 0.10 is
 *                    DOCTRINE-PENDING(Neil) — NOT ratified science.
 *   · p05            5th percentile, SAME population/convention as p10/p50/p90.
 *   · expected_regret mean_i(best_i - o_i) on the PRE-noise CRN population,
 *                    >= 0 by construction.
 *   · All three are REQUIRED floats on DownsideV2 — ISL emits the block whole
 *     or omits it entirely ("Omitted, never null"), and units are the SAME as
 *     outcome.mean with no normalisation.
 *
 * WHAT THIS SUITE ENFORCES AT PLoT'S EGRESS
 *   1  the block reaches `option_comparison[]` (RED at pristine)
 *   2  BOUND BY IDENTITY to its own option — id AND exact label — with a
 *      sibling carrying different values, so no value predicate another option
 *      could satisfy is load-bearing (trap 19)
 *   3  HONEST ABSENCE: a component ISL could not compute honestly omits the
 *      WHOLE block — never a fabricated 0, never a `null`. A zero in a downside
 *      statistic reads as "there is no downside", which is the worst possible
 *      direction for this defect class.
 *   4  POSITIVE CONTROL both ways: the same harness observes the block PRESENT
 *      on one option and ABSENT on its sibling in the SAME response, so neither
 *      arm can pass by testing nothing (trap 13).
 *
 * PRECONDITION PINS. Every assertion about absence is preceded by an assertion
 * that the ISL mock actually put a downside block on the wire for the option in
 * question — otherwise a later tidy-up of the mock rots the guard silently.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — per-option outcome + downside, shaped from ISL's DownsideV2
// ---------------------------------------------------------------------------

/**
 * option_id → the value of `downside` on the ISL wire.
 *  - a DownsideV2-shaped object  → ISL computed the block
 *  - `undefined` (key absent)    → ISL omitted it (its documented absence shape:
 *                                  "Omitted, never null")
 * A `null` arm is deliberately absent: ISL's model serialises the field with
 * exclude-none semantics and its docstring states the block is omitted rather
 * than nulled, so a null arm would pin a shape the producer does not emit
 * (trap 12b — a control pinned to a shape nobody emits tests nothing).
 */
let mockDownsideByOption: Record<string, unknown> = {};
/** option_id → outcome overrides merged over the healthy default. */
let mockOutcomeOverrideByOption: Record<string, Record<string, unknown>> = {};

const HEALTHY_OUTCOME = {
  mean: 0.62,
  std: 0.11,
  p10: 0.44,
  p50: 0.63,
  p90: 0.81,
  n_samples: 1000,
  n_valid_samples: 1000,
  validity_ratio: 1.0,
};

function buildMockOption(opt: { id: string }, idx: number) {
  const downside = mockDownsideByOption[opt.id];
  return {
    option_id: opt.id,
    outcome: { ...HEALTHY_OUTCOME, ...(mockOutcomeOverrideByOption[opt.id] ?? {}) },
    rank: idx + 1,
    win_probability: 0.5,
    status: 'computed',
    // Key omitted entirely when ISL sent nothing — the producer's absence shape.
    ...(downside !== undefined && { downside }),
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
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Programme value', observed_state: { value: 0.4 } },
    { id: 'fac_cost', kind: 'factor', label: 'First-year cost', observed_state: { value: 40000, cap: 60000, unit: '£' } },
  ],
  edges: [{ from: 'fac_cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } }],
};

/**
 * IDENTITY FIXTURES. The two options carry DELIBERATELY DIFFERENT downside
 * values so that no assertion below can be satisfied by the wrong option: an
 * `expect(some option).cvar_10 === -0.42` would pass on either card, which is
 * exactly the "test that passes on the wrong object" failure (trap 19). Every
 * assertion therefore selects by `option_id` AND re-asserts `option_label`.
 */
const OPT_HEDGE_ID = 'opt_hedge';
const OPT_HEDGE_LABEL = 'Hedge and stage the rollout';
const OPT_BOLD_ID = 'opt_bold';
const OPT_BOLD_LABEL = 'Go big in one step';

const OPTIONS = [
  { id: OPT_HEDGE_ID, label: OPT_HEDGE_LABEL, interventions: { fac_cost: 38000 } },
  { id: OPT_BOLD_ID, label: OPT_BOLD_LABEL, interventions: { fac_cost: 52000 } },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

/** DownsideV2-shaped block. Values are distinct per option by construction. */
const HEDGE_DOWNSIDE = { cvar_10: 0.21, p05: 0.29, expected_regret: 0.04 };
const BOLD_DOWNSIDE = { cvar_10: -0.37, p05: -0.18, expected_regret: 0.19 };

async function runAnalysis(baseUrl: string, payload: object): Promise<any> {
  const res = await fetch(`${baseUrl}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
  return res.json();
}

/**
 * Select an option_comparison entry BY IDENTITY: the option_id selects it and
 * the exact option_label is re-asserted, so a response that carried the right
 * numbers under the wrong identity fails here rather than downstream.
 */
function optionByIdentity(body: any, optionId: string, optionLabel: string): any {
  const entry = (body.option_comparison ?? []).find((o: any) => o.option_id === optionId);
  expect(entry, `option_comparison entry for ${optionId}`).toBeDefined();
  expect(entry.option_label, `identity: ${optionId} must be labelled "${optionLabel}"`).toBe(optionLabel);
  return entry;
}

// ---------------------------------------------------------------------------

describe('2.449 — ISL downside/tail-risk block reaches PLoT egress', () => {
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
    mockDownsideByOption = {};
    mockOutcomeOverrideByOption = {};
  });

  // =========================================================================
  // 1 — the block reaches egress, bound to its own option
  // =========================================================================

  it('carries EACH option its OWN downside{cvar_10, p05, expected_regret}, verbatim', async () => {
    mockDownsideByOption = {
      [OPT_HEDGE_ID]: { ...HEDGE_DOWNSIDE },
      [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);

    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    // Verbatim per option — NOT "some option carries these numbers".
    expect(hedge.downside, `${OPT_HEDGE_ID} must carry its own downside block`).toEqual(HEDGE_DOWNSIDE);
    expect(bold.downside, `${OPT_BOLD_ID} must carry its own downside block`).toEqual(BOLD_DOWNSIDE);

    // DISCRIMINATION: the two blocks must not be the same object's values. A
    // builder that read the FIRST option's downside for every option would
    // satisfy the two assertions above only if the fixtures were identical —
    // they are not, and this line says so out loud.
    expect(bold.downside.cvar_10).not.toBe(hedge.downside.cvar_10);
    expect(bold.downside.expected_regret).not.toBe(hedge.downside.expected_regret);
  });

  it('preserves ISL key order cvar_10 → p05 → expected_regret (declaration order on DownsideV2)', async () => {
    mockDownsideByOption = { [OPT_HEDGE_ID]: { ...HEDGE_DOWNSIDE }, [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE } };
    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    expect(Object.keys(hedge.downside)).toEqual(['cvar_10', 'p05', 'expected_regret']);
  });

  // =========================================================================
  // 2 — POSITIVE CONTROL: present and absent are BOTH visible to this harness
  // =========================================================================

  it('POSITIVE CONTROL — one option present, its sibling absent, in the SAME response', async () => {
    // ISL omits the block for opt_bold (its documented absence shape) and emits
    // it for opt_hedge. If the harness could not see BOTH states, one of these
    // two assertions would be vacuous.
    mockDownsideByOption = { [OPT_HEDGE_ID]: { ...HEDGE_DOWNSIDE } };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);

    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    // PRESENT arm — proves the harness can see a block arrive.
    expect(hedge.downside).toEqual(HEDGE_DOWNSIDE);
    // ABSENT arm — proves the harness can see one NOT arrive, on an option that
    // is otherwise fully computed (same outcome, same status) in the same body.
    expect(bold).not.toHaveProperty('downside');
    expect(bold.outcome, 'precondition: the absent-arm option is otherwise healthy').toBeDefined();
    expect(bold.status).toBe('computed');
  });

  // =========================================================================
  // 3 — HONEST ABSENCE: never a fabricated zero, never a null
  // =========================================================================

  it('omits the WHOLE block when a component is non-finite — never a fabricated 0', async () => {
    // ISL's DownsideV2 requires all three as finite floats and omits the block
    // rather than emit a partial one. A wire value that is not finite is a
    // trust-boundary event, and the ONLY honest egress is absence: a zero here
    // would read to a user as "there is no downside".
    mockDownsideByOption = {
      [OPT_HEDGE_ID]: { cvar_10: Number.NaN, p05: 0.29, expected_regret: 0.04 },
      [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    // PRECONDITION PIN: the sibling proves the wire carried downside blocks at
    // all on this run, so the assertion below is about the GUARD and not about
    // a fixture somebody emptied.
    expect(bold.downside, 'precondition: this run DID carry a downside block').toEqual(BOLD_DOWNSIDE);

    expect(hedge).not.toHaveProperty('downside');
    // Said the other way round, because "not.toHaveProperty" would also pass on
    // a block of zeros nested one level deeper: no zero may appear anywhere in
    // the entry's tail-risk surface.
    expect(hedge.downside).toBeUndefined();
  });

  it.each([
    ['cvar_10', { cvar_10: Number.POSITIVE_INFINITY, p05: 0.29, expected_regret: 0.04 }],
    ['p05', { cvar_10: 0.21, p05: Number.NEGATIVE_INFINITY, expected_regret: 0.04 }],
    ['expected_regret', { cvar_10: 0.21, p05: 0.29, expected_regret: Number.NaN }],
    ['null cvar_10', { cvar_10: null, p05: 0.29, expected_regret: 0.04 }],
    ['missing p05', { cvar_10: 0.21, expected_regret: 0.04 }],
    ['string expected_regret', { cvar_10: 0.21, p05: 0.29, expected_regret: '0.04' }],
  ])('omits the whole block when %s is not an honest finite number', async (_name, badBlock) => {
    mockDownsideByOption = { [OPT_HEDGE_ID]: badBlock, [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE } };
    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);
    expect(bold.downside, 'precondition: the good sibling still carries its block').toEqual(BOLD_DOWNSIDE);
    expect(hedge).not.toHaveProperty('downside');
  });

  it('rejects a negative expected_regret — >= 0 by construction at the producer', async () => {
    // ISL declares `expected_regret: float = Field(..., ge=0)`. A negative value
    // on the wire means the producer's invariant broke; PLoT must not launder it.
    mockDownsideByOption = {
      [OPT_HEDGE_ID]: { cvar_10: 0.21, p05: 0.29, expected_regret: -0.01 },
      [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE },
    };
    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);
    expect(bold.downside, 'precondition: the good sibling still carries its block').toEqual(BOLD_DOWNSIDE);
    expect(hedge).not.toHaveProperty('downside');
  });

  it('carries a genuine ZERO expected_regret — a measured 0 is not an absence', async () => {
    // The option that wins every sample has expected_regret ~0 BY CONSTRUCTION.
    // The honest-absence guards above must not swallow it: absent and zero are
    // different facts, and this is the arm that proves the guard distinguishes
    // them rather than treating falsy as missing.
    const winner = { cvar_10: 0.55, p05: 0.58, expected_regret: 0 };
    mockDownsideByOption = { [OPT_HEDGE_ID]: winner, [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE } };
    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    expect(hedge.downside).toEqual(winner);
    expect(hedge.downside.expected_regret).toBe(0);
  });

  // =========================================================================
  // 4 — the block never outlives the outcome it is a tail of
  // =========================================================================

  it('omits downside when the option has no emitted outcome (ISL: downside ⟹ percentiles from samples)', async () => {
    // ISL enforces `downside present ⟹ outcome.percentiles_source == "samples"`.
    // PLoT drops the whole `outcome` object when a required stat is non-finite,
    // so a downside surviving that drop would be a tail statistic with no
    // distribution to be the tail OF.
    mockOutcomeOverrideByOption = { [OPT_HEDGE_ID]: { mean: Number.NaN } };
    mockDownsideByOption = { [OPT_HEDGE_ID]: { ...HEDGE_DOWNSIDE }, [OPT_BOLD_ID]: { ...BOLD_DOWNSIDE } };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    expect(hedge.outcome, 'precondition: the degenerate option has no outcome object').toBeUndefined();
    expect(bold.downside, 'precondition: the healthy sibling still carries its block').toEqual(BOLD_DOWNSIDE);
    expect(hedge).not.toHaveProperty('downside');
  });
});
