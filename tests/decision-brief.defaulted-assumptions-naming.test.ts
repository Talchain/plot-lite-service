/**
 * `decision_brief.defaulted_assumptions[].factor_label` on the RUN-LEVEL
 * `default_disclosure` rows.
 *
 * WHY THIS EXISTS. The defaulted-input disclosure exists so a person can go and
 * set the input the analysis had to guess for. Today the run-level row says
 * "the analysis used a default value for one of the factors in your model" and
 * names nothing, because `factor_label` was hardcoded `null` here and ISL's
 * `ROOT_NODE_DEFAULT_VALUE` carried only a raw node id. Unactionable by
 * construction.
 *
 * The two disclosure sources are NOT interchangeable and this file does not
 * blur them (CLAUDE.md trap 21 — they answer different questions):
 *
 *   `value_defaulted`    — a FACTOR whose central value genuinely fell back to
 *                          0.0. Since ISL ROADMAP 2.1020 a prior-backed factor
 *                          is centred on its declared prior and is deliberately
 *                          NOT flagged, because "no value was provided, so a
 *                          default was used" is false about it.
 *   `default_disclosure` — a run-level inference warning about a genuinely
 *                          defaulted ROOT node. Its population is DISJOINT from
 *                          factor_sensitivity, so the factor-scoped flag can
 *                          never speak for it.
 *
 * This change carries the producer's OWN label onto the second kind. It does
 * not remap one source to the other, and it does not synthesise a name:
 * `factor_label` stays `null` unless ISL supplied a real one, because a
 * fabricated name on a true sentence is worse than an unnamed true sentence.
 *
 * SCOPE — `factor_id` is deliberately NOT added to these rows. That is the
 * standing ruling in decision-brief.defaulted-assumptions-factor-id.test.ts
 * ("inventing one there would be a fabricated join target") and it is not
 * re-litigated here.
 *
 * Rows are bound BY IDENTITY (`code`), never by a value predicate another row
 * could satisfy (CLAUDE.md trap 19).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

const LABEL = 'Billing Migration Complexity';
const RAW_ID = '7841c89e';

// ---------------------------------------------------------------------------
// 1. Assembly — the user-visible decision
// ---------------------------------------------------------------------------

function makeInput(
  warnings: Array<{
    code: string;
    message: string;
    severity: 'info' | 'warning';
    node_label?: string;
  }>,
): BriefAssemblyInput {
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: [
      { option_id: 'opt_a', option_label: 'Keep price', id: 'opt_a', label: 'Keep price', win_probability: 0.6 },
      { option_id: 'opt_b', option_label: 'Raise price', id: 'opt_b', label: 'Raise price', win_probability: 0.4 },
    ] as any[],
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
    factor_sensitivity: [],
    inference_warnings: warnings as BriefAssemblyInput['inference_warnings'],
    meta: { seed_used: '42' },
  } as BriefAssemblyInput;
}

function rowFor(brief: any, code: string) {
  return (brief.defaulted_assumptions ?? []).find((r: any) => r.code === code);
}

describe('defaulted_assumptions — run-level rows carry the producer label', () => {
  it('populates factor_label from the warning node_label', () => {
    const brief = assembleBrief(
      makeInput([
        {
          code: 'ROOT_NODE_DEFAULT_VALUE',
          message: `No starting value was provided for "${LABEL}", so the analysis used a default of 0.0.`,
          severity: 'info',
          node_label: LABEL,
        },
      ]),
    );
    const row = rowFor(brief, 'ROOT_NODE_DEFAULT_VALUE');
    expect(row, 'run-level disclosure row present').toBeDefined();
    // Pin the EXISTING fields too, so a change that moves any current value
    // REDs here rather than passing as "additive".
    expect(row.source).toBe('default_disclosure');
    expect(row.doctrine).toBe('provisional_doctrine_v0');
    expect(row.factor_label).toBe(LABEL);
  });

  it('leaves factor_label null when the producer supplied no label', () => {
    const brief = assembleBrief(
      makeInput([
        {
          code: 'ROOT_NODE_DEFAULT_VALUE',
          message: `No observed value provided for root node '${RAW_ID}'; defaulted to 0.0.`,
          severity: 'info',
        },
      ]),
    );
    const row = rowFor(brief, 'ROOT_NODE_DEFAULT_VALUE');
    expect(row.source).toBe('default_disclosure');
    // NOT the raw id, NOT a manufactured name — absence stays absence.
    expect(row.factor_label).toBeNull();
  });

  it('never derives a label from the warning message', () => {
    // A blank label is still no label. Deriving one by parsing the message
    // would be exactly the fabrication this row exists to avoid.
    const brief = assembleBrief(
      makeInput([
        {
          code: 'ROOT_NODE_DEFAULT_VALUE',
          message: `No starting value was provided for "${LABEL}", so the analysis used a default of 0.0.`,
          severity: 'info',
          node_label: '   ',
        },
      ]),
    );
    expect(rowFor(brief, 'ROOT_NODE_DEFAULT_VALUE').factor_label).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Route — the label survives the ISL-warning merge onto the wire
// ---------------------------------------------------------------------------
//
// The assembly above reads PLoT's FLATTENED warning shape. ISL emits the label
// under `detail.node_label`, so the merge in routes/v2/run.ts is the carrier —
// and a carrier that silently drops the field would leave every assertion above
// green while the user still sees nothing. Harness modelled on
// tests/plot-remediation.isl-degrade-disclosure.route.test.ts.

const ISL_ROOT_DEFAULT_WARNING = {
  code: 'ROOT_NODE_DEFAULT_VALUE',
  field: `nodes[${RAW_ID}].observed_state.value`,
  severity: 'info',
  detail: {
    node_id: RAW_ID,
    node_label: LABEL,
    defaulted_to: 0.0,
    message: `No starting value was provided for "${LABEL}", so the analysis used a default of 0.0. Results for downstream nodes may be unreliable until a real value or range is set.`,
  },
};

const ISL_DATA = {
  options: [
    { option_id: 'opt1', outcome: { mean: 0.8, std: 0.1, p10: 0.6, p50: 0.8, p90: 0.95, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 1, win_probability: 0.7, probability_of_goal: 0.65 },
    { option_id: 'opt2', outcome: { mean: 0.7, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 }, rank: 2, win_probability: 0.3, probability_of_goal: 0.55 },
  ],
  factor_sensitivity: [],
  robustness: {
    score: 0.82,
    label: 'robust',
    fragile_edges: [],
    robust_edges: ['factor-a::goal'],
    edge_e_values: [],
  },
  inference_warnings: [ISL_ROOT_DEFAULT_WARNING],
};

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
  async analyseRobustness() {
    return { ...ISL_DATA, source: 'isl' as const, latency_ms: 42 };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, _body: unknown): Promise<{ data: T | null; error: string | null }> {
    return { data: ISL_DATA as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return {
    ...actual,
    getISLService: () => mockISLService,
    get islService() { return mockISLService; },
  };
});

import { createServer } from '../src/createServer.js';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.4 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Spend', interventions: { 'factor-a': 0.3 } },
];

describe('route — node_label survives the ISL-warning merge', () => {
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
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 'defaulted-naming' }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('carries detail.node_label onto the wire warning', async () => {
    const body = await run();
    const got = (body.inference_warnings ?? []).find(
      (w: { code: string }) => w.code === 'ROOT_NODE_DEFAULT_VALUE',
    );
    expect(got, 'wire warning present').toBeDefined();
    // PRECONDITION PINNED IN-TEST (CLAUDE.md trap 13b): assert the existing
    // carriers still work, so a failure below is provably about node_label and
    // not about the merge having stopped running altogether.
    expect(got.message).toBe(ISL_ROOT_DEFAULT_WARNING.detail.message);
    expect(got.severity).toBe('info');
    expect(got.node_label).toBe(LABEL);
  });

  it('names the factor in decision_brief.defaulted_assumptions', async () => {
    const body = await run();
    const rows = body.decision_brief?.defaulted_assumptions ?? [];
    const row = rows.find((r: { code?: string }) => r.code === 'ROOT_NODE_DEFAULT_VALUE');
    expect(row, 'run-level disclosure row reached the brief').toBeDefined();
    expect(row.source).toBe('default_disclosure');
    expect(row.factor_label).toBe(LABEL);
    // The whole point: a person can act on this sentence.
    expect(row.note).toContain(LABEL);
    expect(row.note).not.toContain(RAW_ID);
  });
});
