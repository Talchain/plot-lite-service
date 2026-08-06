/**
 * ROADMAP 2.581 follow-on — `outcome.percentiles_source` must survive PLoT's
 * egress, and a DEGRADED outcome must be carried honestly rather than deleted.
 * ---------------------------------------------------------------------------
 * WHY THIS MATTERS. `percentiles_source` is the discriminator that separates
 * the downside-omission gates from one another: it is the only field on the
 * wire that says whether p10/p50/p90 came from a real Monte-Carlo sample
 * population at all. Without it, "ISL had no samples" and "ISL had samples but
 * a tail statistic was not finite" are indistinguishable downstream — both
 * present as a missing `downside` block and nothing else.
 *
 * WHERE IT DIED, derived at the bytes (not assumed):
 *   · `rg -na 'percentiles_source' src/` at staging tip e52c0335 → TWO hits,
 *     both COMMENTS (`routes/v2/run.ts:2658`, `coaching/normalise-inputs.ts:146`).
 *     Zero code. The field is never read.
 *   · The death site is the `option_comparison` builder in `routes/v2/run.ts`
 *     (~2594): an EXPLICIT FIELD SELECTION into a fresh object. Same shape of
 *     defect, and the same builder, as the 2.449 downside drop.
 *   · It is a DROP, not a never-emitted, and the proof is a REAL WIRE CAPTURE
 *     rather than a fixture this lane wrote (trap 16's inverse — a fixture you
 *     wrote yourself is not evidence about the wire):
 *       `tests/fixtures/isl-v2-live-20260707/isl-staging-capture.json` carries
 *       `outcome.percentiles_source: "samples"` on all four options, while the
 *       PLoT golden generated FROM that very capture,
 *       `tests/fixtures/isl-v2-live-20260707/plot-v2-run.golden.json`, carries
 *       exactly eight outcome keys and no `percentiles_source`.
 *   · There is no ingress Zod that strips it: `integrations/isl/client.ts:294`
 *     is `JSON.parse(responseText) as T`, an unchecked cast. And there is no
 *     Fastify RESPONSE schema on the route (`runV3Schema` declares `body` only,
 *     run.ts:1276), so Ajv is not removing it at serialisation either. The
 *     builder is the ONLY hop that drops it.
 *
 * PRODUCER-DERIVED SEMANTICS. Read from ISL's `OutcomeDistributionV2`
 * (`src/models/response_v2.py`) at ISL staging `c25836f7`, NOT from this lane's
 * reading of what the field ought to mean (trap 13c — a mutant kit validates
 * sensitivity, never a wrong oracle):
 *   · `percentiles_source: Literal["samples", "unavailable"]`, `default="samples"`.
 *     It is NOT Optional, so `exclude_none=True` never drops it: on a V2 wire it
 *     is ALWAYS present.
 *   · `'samples'`     → p10/p50/p90 computed from actual MC samples.
 *     `'unavailable'` → no valid samples exist, and p10/p50/p90 will be NULL.
 *   · `mean`/`std` are `Optional` and OMITTED (never null) when there is no
 *     honest mean, and ISL's `_summary_stats_absent_only_without_samples`
 *     validator RAISES unless `percentiles_source == 'unavailable'` in that
 *     case. So absent-mean and 'unavailable' co-occur BY PRODUCER INVARIANT.
 *   · `n_samples: int`, `n_valid_samples: int`, `validity_ratio: float` are all
 *     REQUIRED and are therefore present and honest even on the degenerate run.
 *     THEY ARE THE EVIDENCE OF THE DEGENERACY, and PLoT deletes them today.
 *   · `downside` present ⟹ `percentiles_source == 'samples'`, enforced by
 *     `OptionResultV2._downside_requires_samples`.
 *
 * ⚠ CORRECTED PREMISE (a deliverable in its own right). The brief for this lane
 * described the whole-outcome drop as "discarding a good downside block". At
 * the producer that is UNREACHABLE: `downside` may only ride with
 * `percentiles_source == 'samples'`, and with samples `mean`/`p10`/`p50`/`p90`
 * are non-null floats, so `hasAllRequiredOutcomeStats` passes and the outcome
 * is emitted. The reachable harm is different and larger: on the degenerate run
 * PLoT deletes `n_samples` / `n_valid_samples` / `validity_ratio` /
 * `percentiles_source` — every field that would EXPLAIN the degeneracy — and
 * leaves the option with no outcome at all. The downside gate is therefore
 * preserved deliberately below rather than loosened.
 *
 * WHAT THIS SUITE ENFORCES
 *   1  `percentiles_source` reaches `option_comparison[].outcome` verbatim.
 *   2  It is NEVER DEFAULTED. An ISL build that sends no `percentiles_source`
 *      gets an outcome with the key ABSENT — inventing `'samples'` would be a
 *      fabricated provenance claim, which is the same defect class as `?? 0`.
 *   3  A degraded outcome is carried PARTIALLY and honestly: the honest fields
 *      survive, and `mean`/`p10`/`p50`/`p90` are ABSENT — never `0`, never `null`.
 *   4  The `downside` gate still bites: a tail statistic never outlives the
 *      percentile population it summarises.
 *   5  Byte-shape of the healthy path is unchanged except for the appended key,
 *      in ISL's own declaration order.
 *
 * Every assertion binds to its option by IDENTITY (`option_id` AND the exact
 * `option_label`), never by a value predicate a sibling could satisfy (trap 19),
 * and every absence assertion is preceded by a PRECONDITION pin that the mock
 * actually put the relevant shape on the wire, plus a healthy sibling in the
 * SAME response as the positive control (trap 13).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock
// ---------------------------------------------------------------------------

/** option_id → the literal `outcome` object ISL puts on the wire. */
let mockOutcomeByOption: Record<string, unknown> = {};
/** option_id → the literal `downside` object ISL puts on the wire (key omitted when undefined). */
let mockDownsideByOption: Record<string, unknown> = {};

/**
 * A fully-healthy `OutcomeDistributionV2`, key order and values transcribed
 * from the REAL staging capture at
 * `tests/fixtures/isl-v2-live-20260707/isl-staging-capture.json`
 * (option `opt_one_dev`) — a wire artefact, not a shape this lane invented.
 */
const HEALTHY_OUTCOME = {
  mean: 0.10179725550865354,
  std: 0.11941813998438616,
  p10: -0.046497474297611675,
  p50: 0.10615207437561272,
  p90: 0.24657456603769748,
  n_samples: 4000,
  n_valid_samples: 4000,
  validity_ratio: 1,
  percentiles_source: 'samples',
};

/**
 * The DEGENERATE shape. Transcribed from ISL's own integration test
 * `tests/integration/test_numerics_honesty_batch.py`
 * (`TestAllNonFiniteOptionShipsOn200`) and cross-checked against the field
 * declarations on `OutcomeDistributionV2` at ISL staging `c25836f7`:
 * `mean`/`std` ABSENT (omitted under `exclude_none`, never null), p10/p50/p90
 * NULL, the three sample-census fields present and honest,
 * `percentiles_source: 'unavailable'`.
 *
 * This is the ONLY wire-reachable trigger for PLoT's whole-outcome drop:
 * `hasAllRequiredOutcomeStats` uses `finiteNum`, which rejects `null` and
 * `undefined` as well as NaN/±Infinity.
 */
const DEGENERATE_OUTCOME = {
  p10: null,
  p50: null,
  p90: null,
  n_samples: 4000,
  n_valid_samples: 0,
  validity_ratio: 0,
  percentiles_source: 'unavailable',
};

function buildMockOption(opt: { id: string }, idx: number) {
  const downside = mockDownsideByOption[opt.id];
  const outcome = mockOutcomeByOption[opt.id] ?? { ...HEALTHY_OUTCOME };
  return {
    option_id: opt.id,
    outcome,
    rank: idx + 1,
    win_probability: 0.5,
    status: 'computed',
    ...(downside !== undefined && { downside }),
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

const OPT_HEDGE_ID = 'opt_hedge';
const OPT_HEDGE_LABEL = 'Hedge and stage the rollout';
const OPT_BOLD_ID = 'opt_bold';
const OPT_BOLD_LABEL = 'Go big in one step';

const OPTIONS = [
  { id: OPT_HEDGE_ID, label: OPT_HEDGE_LABEL, interventions: { fac_cost: 38000 } },
  { id: OPT_BOLD_ID, label: OPT_BOLD_LABEL, interventions: { fac_cost: 52000 } },
];

const BASE_PAYLOAD = { graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '42' };

async function runAnalysis(baseUrl: string, payload: object): Promise<any> {
  const res = await fetch(`${baseUrl}/v2/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** Select by IDENTITY: option_id selects, the exact option_label is re-asserted. */
function optionByIdentity(body: any, optionId: string, optionLabel: string): any {
  const entry = (body.option_comparison ?? []).find((o: any) => o.option_id === optionId);
  expect(entry, `option_comparison entry for ${optionId}`).toBeDefined();
  expect(entry.option_label, `identity: ${optionId} must be labelled "${optionLabel}"`).toBe(optionLabel);
  return entry;
}

// ---------------------------------------------------------------------------

describe('2.581 — outcome.percentiles_source survives PLoT egress', () => {
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
    mockOutcomeByOption = {};
    mockDownsideByOption = {};
  });

  // =========================================================================
  // 1 — the discriminator reaches egress, bound to its own option
  // =========================================================================

  it('carries EACH option its OWN outcome.percentiles_source verbatim', async () => {
    // The two options carry DIFFERENT values, so no assertion below can be
    // satisfied by the wrong entry (trap 19): a builder that read the first
    // option's outcome for every option fails the discrimination line.
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: { ...HEALTHY_OUTCOME, percentiles_source: 'samples' },
      [OPT_BOLD_ID]: { ...DEGENERATE_OUTCOME },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);

    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    expect(hedge.outcome?.percentiles_source, `${OPT_HEDGE_ID} sampled provenance`).toBe('samples');
    expect(bold.outcome?.percentiles_source, `${OPT_BOLD_ID} unavailable provenance`).toBe('unavailable');

    // DISCRIMINATION: the two must differ, so neither assertion can be passing
    // on the other option's block.
    expect(bold.outcome.percentiles_source).not.toBe(hedge.outcome.percentiles_source);
  });

  it('appends percentiles_source LAST, matching ISL OutcomeDistributionV2 declaration order', async () => {
    mockOutcomeByOption = { [OPT_HEDGE_ID]: { ...HEALTHY_OUTCOME } };
    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    // The eight pre-existing keys in their pre-existing order, then the new one.
    expect(Object.keys(hedge.outcome)).toEqual([
      'mean', 'std', 'p10', 'p50', 'p90',
      'n_samples', 'n_valid_samples', 'validity_ratio',
      'percentiles_source',
    ]);
  });

  // =========================================================================
  // 2 — NEVER DEFAULTED. Absence stays absence.
  // =========================================================================

  it('OMITS percentiles_source when ISL sent none — never defaults it to "samples"', async () => {
    // An ISL build predating CIL 0.2 sends no `percentiles_source`. Substituting
    // the producer's own Python default here would manufacture a provenance
    // claim PLoT never received — the `?? 0` defect class wearing a string.
    const { percentiles_source: _omitted, ...noProvenance } = HEALTHY_OUTCOME;
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: noProvenance,
      [OPT_BOLD_ID]: { ...HEALTHY_OUTCOME },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    // POSITIVE CONTROL in the SAME response: the sibling DID send it and it
    // arrives, so the absence below cannot be the harness failing to look.
    expect(bold.outcome.percentiles_source, 'positive control: sibling carries it').toBe('samples');

    expect(hedge.outcome, 'precondition: the option still has an outcome block').toBeDefined();
    expect(hedge.outcome).not.toHaveProperty('percentiles_source');
  });

  it('OMITS a percentiles_source outside ISL\'s declared literals — never launders an unknown value', async () => {
    // `Literal["samples","unavailable"]` is the producer's whole domain. Anything
    // else is upstream garbage or a contract PLoT has not been taught; passing it
    // through would let a downstream surface branch on a value no producer means.
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: { ...HEALTHY_OUTCOME, percentiles_source: 'interpolated' },
      [OPT_BOLD_ID]: { ...HEALTHY_OUTCOME },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    expect(bold.outcome.percentiles_source, 'positive control: sibling carries it').toBe('samples');
    expect(hedge.outcome).not.toHaveProperty('percentiles_source');
  });

  // =========================================================================
  // 3 — a DEGRADED outcome is carried PARTIALLY and honestly
  // =========================================================================

  it('carries the honest fields of a degenerate outcome instead of deleting the whole block', async () => {
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: { ...DEGENERATE_OUTCOME },
      [OPT_BOLD_ID]: { ...HEALTHY_OUTCOME },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    // POSITIVE CONTROL: the healthy sibling's full block in the SAME response.
    // NOTE the oracle here is PRESENCE-AND-FINITENESS, not the raw ISL value:
    // `denormaliseOptionResult` (lib/intervention-normaliser.ts) rescales
    // mean/std/p10/p50/p90 into goal units before this builder sees them, so an
    // equality against the fixture's `mean` would be a wrong oracle (trap 13c —
    // this lane wrote exactly that assertion first and the harness caught it).
    // `percentiles_source` is NOT rescaled: that function spreads the outcome
    // object, which is why the field reaches the builder intact.
    expect(bold.outcome, 'positive control: healthy sibling has an outcome').toBeDefined();
    expect(Number.isFinite(bold.outcome.mean), 'positive control: healthy sibling keeps a finite mean').toBe(true);

    // The census fields are ISL-REQUIRED and honest on the degenerate run — they
    // are the evidence OF the degeneracy, and the whole-block drop deleted them.
    expect(hedge.outcome, 'degenerate option must still carry an outcome block').toBeDefined();
    expect(hedge.outcome.n_samples).toBe(4000);
    expect(hedge.outcome.n_valid_samples).toBe(0);
    expect(hedge.outcome.validity_ratio).toBe(0);
    expect(hedge.outcome.percentiles_source).toBe('unavailable');
  });

  it('ABSENT ≠ ZERO: the unmeasurable stats are omitted, never 0 and never null', async () => {
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: { ...DEGENERATE_OUTCOME },
      [OPT_BOLD_ID]: { ...HEALTHY_OUTCOME },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);

    for (const key of ['mean', 'std', 'p10', 'p50', 'p90']) {
      expect(hedge.outcome, `${key} must be ABSENT, not defaulted`).not.toHaveProperty(key);
    }
    // Said explicitly, because the fabrication direction is what does the harm:
    // a 0 in `mean` does not read as "unknown", it reads as "this option is worth
    // nothing", and a 0 in `p10` reads as a measured floor.
    expect(hedge.outcome.mean).toBeUndefined();
    expect(hedge.outcome.p10).toBeUndefined();

    // A MEASURED ZERO IS NOT AN ABSENCE. `n_valid_samples: 0` and
    // `validity_ratio: 0` are real measurements and must survive — this is the
    // arm that proves the guard tests finiteness, not truthiness.
    expect(hedge.outcome).toHaveProperty('n_valid_samples');
    expect(hedge.outcome.n_valid_samples).toBe(0);
    expect(hedge.outcome).toHaveProperty('validity_ratio');
    expect(hedge.outcome.validity_ratio).toBe(0);
  });

  it('emits NO outcome key at all when ISL sent an outcome with nothing honest in it', async () => {
    // An empty `outcome: {}` on the wire must not become `outcome: {}` on egress:
    // an empty object is a shape a consumer can mistake for a computed result.
    // Absence of every field means absence of the block.
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: { mean: Number.NaN, p10: null, p50: null, p90: null },
      [OPT_BOLD_ID]: { ...HEALTHY_OUTCOME },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    expect(bold.outcome, 'positive control: sibling has a block').toBeDefined();
    expect(hedge).not.toHaveProperty('outcome');
  });

  // =========================================================================
  // 4 — the downside gate must NOT be loosened by the partial-carry change
  // =========================================================================

  it('still omits downside when the percentile population is unavailable (ISL: downside ⟹ samples)', async () => {
    // Before this change the gate was `outcome !== undefined`, which held only
    // because a degraded outcome was deleted entirely. Now that a partial
    // outcome IS emitted, that gate would let a tail statistic ride alongside a
    // block with no percentiles to be the tail OF. The gate must bind to the
    // PERCENTILE POPULATION, mirroring the producer's own invariant.
    mockOutcomeByOption = {
      [OPT_HEDGE_ID]: { ...DEGENERATE_OUTCOME },
      [OPT_BOLD_ID]: { ...HEALTHY_OUTCOME },
    };
    mockDownsideByOption = {
      [OPT_HEDGE_ID]: { cvar_10: 0.21, p05: 0.29, expected_regret: 0.04 },
      [OPT_BOLD_ID]: { cvar_10: -0.37, p05: -0.18, expected_regret: 0.19 },
    };

    const body = await runAnalysis(baseUrl, BASE_PAYLOAD);
    const hedge = optionByIdentity(body, OPT_HEDGE_ID, OPT_HEDGE_LABEL);
    const bold = optionByIdentity(body, OPT_BOLD_ID, OPT_BOLD_LABEL);

    // PRECONDITIONS: the mock really did put a downside on the wire for BOTH,
    // and the healthy sibling's really does arrive — so the absence below is
    // the gate's doing and not the fixture's failure (trap 13b).
    expect(bold.downside, 'precondition/positive control: healthy sibling keeps its block')
      .toEqual({ cvar_10: -0.37, p05: -0.18, expected_regret: 0.19 });
    expect(hedge.outcome.percentiles_source, 'precondition: the degraded option is "unavailable"')
      .toBe('unavailable');

    expect(hedge).not.toHaveProperty('downside');
  });
});
