/**
 * A3 lane 2 Fix B (r2 residual R1, 2026-07-16): `elasticity_std` joins the
 * D-U lever suppression contract (LEVER_SUPPRESSION_FIELDS).
 *
 * The live universality re-run on the verbatim-original fac_salary_cost graph
 * proved the shipped contract zeroes sensitivity/elasticity/VOI + stamps
 * zero_reason for option-controlled levers, but the lever still egressed
 * `elasticity_std: 0.00396846` — a non-zero variance statistic of the very
 * metric the contract suppresses.
 *
 * Coverage — every merge branch where LEVER_SUPPRESSION_FIELDS is spread
 * (src/lib/factor-influence.ts):
 *   1. islMatch branch (suppression spread last in the merge literal): union
 *      lever AND ISL-stamped lever with non-zero ISL elasticity_std → 0.
 *   2. empty-islFactors early-return branch: union member → key forced to 0.
 *   3. no-islMatch branch (ISL returned entries, none for this factor) → 0.
 *   (4. The ISL-only append branch never spreads the contract — levers are
 *      SKIPPED there entirely, so omission ≥ zeroing by construction.)
 *
 * Positive controls (an absence assertion needs a visible presence):
 *   - an unpinned factor's non-zero elasticity_std is preserved verbatim at
 *     the unit level and remains non-zero on the wire at the route level.
 *   - idempotence: an ISL-stamped lever already carrying elasticity_std 0 is
 *     deep-equal with and without the structural union set.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mergeIslConfidenceIntoGraphFactors, buildFactorStability } from '../src/lib/factor-influence.js';
import type { FactorSensitivityResultV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Unit level — mergeIslConfidenceIntoGraphFactors branches
// ---------------------------------------------------------------------------

function graphFactor(id: string, over: Partial<FactorSensitivityResultV3> = {}): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: id,
    influence_score: 0.8,
    influence_rank: 1,
    sensitivity_score: 0.7,
    elasticity: 0.8,
    direction: 'positive',
    importance_rank: 1,
    value_of_information: 0.4,
    confidence: 0.6,
    confidence_source: 'plot_unified_from_graph',
    confidence_components: { structural_certainty: 0.9, sampling_stability: null },
    source: 'graph',
    ...over,
  } as FactorSensitivityResultV3;
}

function islEntry(id: string, over: Record<string, unknown> = {}): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    sensitivity_score: 0.3,
    direction: 'positive',
    attribution_stability: 'low',
    source: 'isl',
    ...over,
  } as unknown as FactorSensitivityResultV3;
}

describe('LEVER_SUPPRESSION_FIELDS covers elasticity_std (unit, all spread branches)', () => {
  it('islMatch branch: a union lever with non-zero ISL elasticity_std egresses elasticity_std 0 (the live fac_salary_cost leak)', () => {
    const [lever] = mergeIslConfidenceIntoGraphFactors(
      [graphFactor('fac_lever')],
      [islEntry('fac_lever', { elasticity_std: 0.00396846 })],
      [],
      new Set(['fac_lever']),
    );
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.elasticity_std).toBe(0);
    // the rest of the contract still holds alongside the new field
    expect(lever.sensitivity_score).toBe(0);
    expect(lever.elasticity).toBe(0);
    expect(lever.value_of_information).toBe(0);
  });

  it('islMatch branch: an ISL-STAMPED lever (no union set) with non-zero elasticity_std is also forced to 0', () => {
    const [lever] = mergeIslConfidenceIntoGraphFactors(
      [graphFactor('fac_stamped')],
      [islEntry('fac_stamped', { sensitivity_score: 0, zero_reason: 'intervention_override', elasticity_std: 0.005 })],
      [],
    );
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.elasticity_std).toBe(0);
  });

  it('empty-islFactors branch: a union member carries elasticity_std 0 (key forced, not just absent)', () => {
    const [lever] = mergeIslConfidenceIntoGraphFactors(
      [graphFactor('fac_union')],
      [],
      [],
      new Set(['fac_union']),
    );
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.elasticity_std).toBe(0);
  });

  it('no-islMatch branch: a union member absent from a NON-empty ISL set carries elasticity_std 0', () => {
    const [lever, plain] = mergeIslConfidenceIntoGraphFactors(
      [graphFactor('fac_union'), graphFactor('fac_plain')],
      [islEntry('fac_plain', { elasticity_std: 0.00750934 })],
      [],
      new Set(['fac_union']),
    );
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.elasticity_std).toBe(0);
    // positive control in the same merge: the unpinned factor keeps its value
    expect(plain.zero_reason ?? null).toBeNull();
    expect(plain.elasticity_std).toBe(0.00750934);
  });

  it('positive control: an unpinned factor with non-zero ISL elasticity_std is preserved verbatim', () => {
    const [plain] = mergeIslConfidenceIntoGraphFactors(
      [graphFactor('fac_plain')],
      [islEntry('fac_plain', { elasticity_std: 0.00750934 })],
      [],
      new Set(['fac_other']),
    );
    expect(plain.zero_reason ?? null).toBeNull();
    expect(plain.elasticity_std).toBe(0.00750934);
    expect(plain.sensitivity_score).not.toBe(0);
  });

  it('idempotence: an ISL-stamped lever already at elasticity_std 0 is deep-equal with and without the union set', () => {
    const graph = () => [graphFactor('fac_lever')];
    const isl = () => [islEntry('fac_lever', { sensitivity_score: 0, zero_reason: 'intervention_override', elasticity_std: 0 })];
    const withUnion = mergeIslConfidenceIntoGraphFactors(graph(), isl(), [], new Set(['fac_lever']));
    const withoutUnion = mergeIslConfidenceIntoGraphFactors(graph(), isl(), []);
    expect(JSON.stringify(withUnion)).toBe(JSON.stringify(withoutUnion));
    expect(withUnion[0].elasticity_std).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Route level — /v2/run egress (mirrors the r2 universality-rerun probe set)
// ---------------------------------------------------------------------------

const UNION_ID = 'fac_union_lever';   // pinned ONLY by the NON-first option, unstamped (the leak class)
const STAMPED_ID = 'fac_stamped_lever'; // first-option pin, ISL-stamped
const PLAIN_ID = 'fac_plain';         // pinned by nobody — positive control

const ISL_FACTOR_SENSITIVITY = [
  { node_id: UNION_ID, sensitivity: -0.19, direction: 'negative' as const, elasticity_std: 0.00396846, attribution_stability: 'low', rank_flip_rate: 0.3, stability_method: 'bootstrap_20' },
  { node_id: STAMPED_ID, sensitivity: 0, zero_reason: 'intervention_override', direction: 'positive' as const, elasticity_std: 0.005, attribution_stability: 'low', rank_flip_rate: 0.2, stability_method: 'bootstrap_20' },
  { node_id: PLAIN_ID, sensitivity: 0.5, direction: 'positive' as const, elasticity_std: 0.00750934, attribution_stability: 'low', rank_flip_rate: 0.05, stability_method: 'bootstrap_20' },
];

function robustnessPayload(options: any[]) {
  return {
    options: (options ?? []).map((opt: any, idx: number) => ({
      option_id: opt.id,
      win_probability: idx === 0 ? 0.7 : 0.3,
      outcome: { mean: 0.7 - idx * 0.2, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
      rank: idx + 1,
    })),
    edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const, edge_sensitivity_status: 'available' as const,
    factors: ISL_FACTOR_SENSITIVITY,
    factor_sensitivity: ISL_FACTOR_SENSITIVITY,
    value_of_information: [],
    factors_provenance: 'isl' as const, factor_sensitivity_status: 'available' as const,
    robustness: { score: 0.8, label: 'robust' as const, fragile_edges: [], robust_edges: [] },
    overall_robustness: 'robust' as const, robustness_score: 0.8, fragile_edges: [], robust_edges: [],
    latency_ms: 50, source: 'isl' as const,
  };
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return robustnessPayload(options);
  },
  async analyseFactorSensitivity() {
    return { factors: ISL_FACTOR_SENSITIVITY, value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'isl' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    return { data: robustnessPayload(body?.options ?? []) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Goal' },
      { id: UNION_ID, kind: 'factor', label: 'Union Lever', observed_state: { value: 0.6 } },
      { id: STAMPED_ID, kind: 'factor', label: 'Stamped Lever', observed_state: { value: 0.5 } },
      { id: PLAIN_ID, kind: 'factor', label: 'Background Factor', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: UNION_ID, to: 'goal', exists_probability: 0.95, strength: { mean: 0.9, std: 0.1 } },
      { from: STAMPED_ID, to: 'goal', exists_probability: 0.9, strength: { mean: 0.8, std: 0.1 } },
      { from: PLAIN_ID, to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
    ],
  },
  options: [
    { id: 'opt_a', label: 'A', interventions: { [STAMPED_ID]: { value: 1, source: 'user_specified' } } },
    { id: 'opt_b', label: 'B', interventions: { [UNION_ID]: { value: 0.2, source: 'user_specified' } } },
  ],
  goal_node_id: 'goal',
  seed: '42',
};

describe('/v2/run egress: lever elasticity_std suppressed, unpinned preserved', () => {
  let factors: any[];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    const app: FastifyInstance = await createServer();
    try {
      const res = await app.inject({
        method: 'POST', url: '/v2/run',
        headers: { 'content-type': 'application/json' },
        payload: PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      factors = (res.json().factor_sensitivity ?? []) as any[];
    } finally {
      await app.close();
      delete process.env.RATE_LIMIT_ENABLED;
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
    }
  });

  it('the non-first-option (unstamped) lever egresses elasticity_std 0', () => {
    const lever = factors.find((f) => f.factor_id === UNION_ID);
    expect(lever).toBeDefined();
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.elasticity_std).toBe(0);
  });

  it('the ISL-stamped lever egresses elasticity_std 0', () => {
    const lever = factors.find((f) => f.factor_id === STAMPED_ID);
    expect(lever).toBeDefined();
    expect(lever.zero_reason).toBe('intervention_override');
    expect(lever.elasticity_std).toBe(0);
  });

  it('positive control: the unpinned factor keeps a non-zero elasticity_std on the wire', () => {
    const plain = factors.find((f) => f.factor_id === PLAIN_ID);
    expect(plain).toBeDefined();
    expect(plain.zero_reason ?? null).toBeNull();
    expect(typeof plain.elasticity_std).toBe('number');
    expect(plain.elasticity_std).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Fixup (coordinator, same lane): the SECOND surface. The r2 evidence saw the
// live lever elasticity_std leak in BOTH factor_sensitivity[2] AND
// factor_stability[0] — suppressing only the first would ship a half-true
// suppression claim. factor_stability had NO lever handling at all (pure
// validity-gate + dedup over RAW ISL entries), so the closest precedent
// applies: zero-in-place like the sibling factor_sensitivity surface (entry
// presence retained — dropping entries would be a bigger behaviour change
// than the ruled leak; FactorStabilityEntry has no zero_reason field, and the
// authoritative stamp for the same factor_id rides factor_sensitivity).
// ---------------------------------------------------------------------------

describe('buildFactorStability: lever elasticity_std suppressed on the stability surface (unit)', () => {
  const GRAPH_MIN = {
    nodes: [
      { id: 'fac_union', kind: 'factor', label: 'Union Lever' },
      { id: 'fac_stamped', kind: 'factor', label: 'Stamped Lever' },
      { id: 'fac_plain', kind: 'factor', label: 'Plain Factor' },
    ],
    edges: [],
  } as any;

  function rawIsl(id: string, over: Record<string, unknown> = {}) {
    return {
      node_id: id,
      sensitivity: 0.3,
      elasticity_std: 0.00396846,
      attribution_stability: 'low',
      rank_flip_rate: 0.3,
      stability_method: 'bootstrap_20',
      ...over,
    };
  }

  it('a union lever (unstamped) egresses elasticity_std 0; entry presence + other 3C fields retained', () => {
    const out = buildFactorStability(
      [rawIsl('fac_union'), rawIsl('fac_plain', { elasticity_std: 0.00750934, rank_flip_rate: 0.05 })],
      GRAPH_MIN,
      new Set(['fac_union']),
    );
    const lever = out.find((e) => e.factor_id === 'fac_union');
    expect(lever).toBeDefined();
    expect(lever!.elasticity_std).toBe(0);
    expect(lever!.attribution_stability).toBe('low');
    expect(lever!.rank_flip_rate).toBe(0.3);
    expect(lever!.stability_method).toBe('bootstrap_20');
    // positive control in the same call: unpinned raw value preserved verbatim
    const plain = out.find((e) => e.factor_id === 'fac_plain');
    expect(plain!.elasticity_std).toBe(0.00750934);
  });

  it('an ISL-STAMPED lever (zero_reason, no union set) also egresses elasticity_std 0', () => {
    const out = buildFactorStability(
      [rawIsl('fac_stamped', { sensitivity: 0, zero_reason: 'intervention_override', elasticity_std: 0.005 })],
      GRAPH_MIN,
    );
    expect(out).toHaveLength(1);
    expect(out[0].factor_id).toBe('fac_stamped');
    expect(out[0].elasticity_std).toBe(0);
  });

  it('suppression keys ONLY on the lever predicate: unstamped + no union set → raw value preserved', () => {
    const out = buildFactorStability([rawIsl('fac_plain', { elasticity_std: 0.00750934 })], GRAPH_MIN);
    expect(out[0].elasticity_std).toBe(0.00750934);
  });

  it('domain validity gate still applies to the RAW value (a lever with invalid raw std is skipped, not zero-laundered)', () => {
    const out = buildFactorStability(
      [rawIsl('fac_union', { elasticity_std: -1 })],
      GRAPH_MIN,
      new Set(['fac_union']),
    );
    expect(out).toHaveLength(0);
  });
});

describe('/v2/run egress: factor_stability surface (fixup — second surface of r2 R1)', () => {
  let stability: any[];

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    const app: FastifyInstance = await createServer();
    try {
      const res = await app.inject({
        method: 'POST', url: '/v2/run',
        headers: { 'content-type': 'application/json' },
        payload: PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      stability = (res.json().factor_stability ?? []) as any[];
    } finally {
      await app.close();
      delete process.env.RATE_LIMIT_ENABLED;
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
    }
  });

  it('the union lever RETAINS its factor_stability entry but egresses elasticity_std 0', () => {
    const lever = stability.find((e) => e.factor_id === UNION_ID);
    expect(lever).toBeDefined();
    expect(lever.elasticity_std).toBe(0);
    expect(lever.attribution_stability).toBe('low');
  });

  it('the ISL-stamped lever egresses elasticity_std 0 in factor_stability', () => {
    const lever = stability.find((e) => e.factor_id === STAMPED_ID);
    expect(lever).toBeDefined();
    expect(lever.elasticity_std).toBe(0);
  });

  it('positive control: the unpinned factor keeps a non-zero elasticity_std in factor_stability', () => {
    const plain = stability.find((e) => e.factor_id === PLAIN_ID);
    expect(plain).toBeDefined();
    expect(plain.elasticity_std).toBeGreaterThan(0);
  });
});
