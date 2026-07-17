/**
 * A3 lane 3 — dark carry-through of ISL flip-threshold stability bands.
 *
 * ISL PR #71 (flag-gated `ISL_FLIP_STABILITY_BANDS`, default OFF) adds
 * `robustness.edge_e_values[].stability` to the ISL V2 response. PLoT's
 * `transformEdgeEValues` (src/routes/v2/run.ts) rebuilds each entry
 * field-by-field, so before this lane an incoming `stability` band was
 * silently DROPPED. These tests pin the carry-through contract:
 *
 *   1. UNITS COHERENCE (A3 lane 4, Paul's 17 Jul ruling): band values are
 *      ALWAYS in the same space as `flip_mean` on the same entry. On the
 *      path where flip_mean is denormalised (normContext + goal range) the
 *      band receives the IDENTICAL affine map, with `band_width` RECOMPUTED
 *      from the mapped endpoints (never offset-mapped) and null
 *      `seed_flip_means` cells preserved. On the paths where flip_mean is
 *      verbatim (no normContext; `_normalised:true`) the band is verbatim
 *      too — see the units note on ISLFlipStabilityBandV2.
 *   2. Honest absence: when ISL omits `stability` (the live wire today —
 *      flag OFF), the outward entry carries NO `stability` key (absent,
 *      never null).
 *   3. Envelope-guard interaction: a stability-bearing body still parses
 *      against the lane-1 egress guard (`AnalysisEnrichmentSchema` is
 *      passthrough at every level) — `_meta.evidence.enrichment_contract_ok`
 *      stays true.
 *
 * Harness modelled on tests/track-s-provenance-passthrough.test.ts (single
 * vi.mock of the ISL service so the mocked envelope actually reaches the
 * route).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ISLEdgeEValue } from '../src/integrations/isl/types/isl-types.js';

// --- ISL-shaped stability bands (mirrors ISL FlipStabilityBandV2 emission:
// model_dump(by_alias=True, exclude_none=True) — band_* keys ABSENT when
// n_seeds_flipped == 0; in-array nulls in seed_flip_means survive).
const FULL_BAND = {
  n_seeds: 5,
  n_seeds_flipped: 3,
  band_min: 0.41,
  band_median: 0.47,
  band_max: 0.62,
  band_width: 0.21,
  seed_flip_means: [0.41, null, 0.47, 0.62, null],
};

// Single-seed-flip trap case: band_width 0.0 BY CONSTRUCTION — carried
// verbatim, never reinterpreted (consumers condition on n_seeds_flipped).
const SINGLE_FLIP_BAND = {
  n_seeds: 5,
  n_seeds_flipped: 1,
  band_min: 0.55,
  band_median: 0.55,
  band_max: 0.55,
  band_width: 0.0,
  seed_flip_means: [null, null, 0.55, null, null],
};

// No-flip case: exclude_none drops the band_* fields entirely.
const NO_FLIP_BAND = {
  n_seeds: 5,
  n_seeds_flipped: 0,
  seed_flip_means: [null, null, null, null, null],
};

const ISL_EDGE_E_VALUES = [
  {
    edge_id: 'factor-a->goal',
    from_id: 'factor-a',
    to_id: 'goal',
    e_value: 2.31,
    flip_direction: 'decrease',
    current_mean: 0.5,
    flip_mean: 0.47,
    stability: FULL_BAND,
  },
  {
    edge_id: 'factor-b->goal',
    from_id: 'factor-b',
    to_id: 'goal',
    e_value: 1.87,
    flip_direction: 'increase',
    current_mean: 0.3,
    flip_mean: 0.55,
    stability: SINGLE_FLIP_BAND,
  },
  {
    edge_id: 'factor-c->goal',
    from_id: 'factor-c',
    to_id: 'goal',
    e_value: 3.02,
    flip_direction: 'decrease',
    current_mean: 0.6,
    flip_mean: 0.2,
    stability: NO_FLIP_BAND,
  },
  {
    // Flag-off shape (the live wire today): NO stability key at all.
    edge_id: 'factor-d->goal',
    from_id: 'factor-d',
    to_id: 'goal',
    e_value: 4.5,
    flip_direction: 'increase',
    current_mean: 0.2,
    flip_mean: 0.9,
  },
];

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
    edge_e_values: ISL_EDGE_E_VALUES,
  },
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
  // Fully lazy (arrow + getter): this file's import graph pulls run.ts, so the
  // hoisted factory can execute before the consts above initialise — an eager
  // `islService: mockISLService` would throw a TDZ ReferenceError here.
  return {
    ...actual,
    getISLService: () => mockISLService,
    get islService() { return mockISLService; },
  };
});

// NOTE: imported AFTER the vi.mock factory's captured consts are initialised
// (vite-node evaluates static imports in source position; a top-of-file import
// of run.js would execute the hoisted mock factory before mockISLService
// exists — same ordering discipline as track-s-provenance-passthrough.test.ts).
import { createServer } from '../src/createServer.js';
import { transformEdgeEValues } from '../src/routes/v2/run.js';

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.4 } },
    { id: 'factor-c', kind: 'factor', label: 'Pricing', observed_state: { value: 0.5 } },
    { id: 'factor-d', kind: 'factor', label: 'Headcount', observed_state: { value: 0.3 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.3, std: 0.1 } },
    { from: 'factor-c', to: 'goal', strength: { mean: 0.6, std: 0.1 } },
    { from: 'factor-d', to: 'goal', strength: { mean: 0.2, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Spend', interventions: { 'factor-a': 0.3 } },
];

// --- A3 lane 4: request that ACTIVATES normalisation (raw intervention
// values outside [0,1]) with an explicit goal range whose affine map is a
// positive control (min ≠ 0, width ≠ 1): v → v·50 + 10.
const NORM_GOAL_RANGE = { min: 10, max: 60 };
const dnGoal = (v: number) => v * (NORM_GOAL_RANGE.max - NORM_GOAL_RANGE.min) + NORM_GOAL_RANGE.min;

const NORM_GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue', state_space: { range: NORM_GOAL_RANGE } },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', state_space: { range: { min: 0, max: 100000 } } },
    { id: 'factor-b', kind: 'factor', label: 'Churn Rate', observed_state: { value: 0.4 } },
    { id: 'factor-c', kind: 'factor', label: 'Pricing', observed_state: { value: 0.5 } },
    { id: 'factor-d', kind: 'factor', label: 'Headcount', observed_state: { value: 0.3 } },
  ],
  edges: GRAPH.edges,
};

const NORM_OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 80000 } },
  { id: 'opt2', label: 'Reduce Spend', interventions: { 'factor-a': 30000 } },
];

describe('lane 3 — transformEdgeEValues stability carry-through (unit)', () => {
  it('carries a stability band through VERBATIM (deep-equal to the ISL bytes)', () => {
    const out = transformEdgeEValues(ISL_EDGE_E_VALUES as unknown as ISLEdgeEValue[]);
    expect(out).toHaveLength(4);
    expect(out[0]!.stability).toEqual(FULL_BAND);
    // Single-seed-flip trap entry: band_width 0 carried verbatim, no reinterpretation.
    expect(out[1]!.stability).toEqual(SINGLE_FLIP_BAND);
    expect(out[1]!.stability!.band_width).toBe(0);
    expect(out[1]!.stability!.n_seeds_flipped).toBe(1);
  });

  it('carries the no-flip band shape verbatim — band_* keys stay ABSENT, not null', () => {
    const out = transformEdgeEValues(ISL_EDGE_E_VALUES as unknown as ISLEdgeEValue[]);
    const noFlip = out[2]!.stability as Record<string, unknown>;
    expect(noFlip).toEqual(NO_FLIP_BAND);
    for (const k of ['band_min', 'band_median', 'band_max', 'band_width']) {
      expect(k in noFlip).toBe(false);
    }
    // In-array nulls preserved.
    expect(noFlip.seed_flip_means).toEqual([null, null, null, null, null]);
  });

  it('emits NO stability key (not null) when ISL omits it', () => {
    const out = transformEdgeEValues(ISL_EDGE_E_VALUES as unknown as ISLEdgeEValue[]);
    expect('stability' in out[3]!).toBe(false);
    expect(out[3]!.stability).toBeUndefined();
  });

  it('maps the stability band IDENTICALLY to flip_mean under active normalisation (A3 lane 4 units coherence)', () => {
    // Positive-control range: min ≠ 0 AND (max − min) ≠ 1, so BOTH a dropped
    // scale and a dropped/spurious offset are visible — an identity range
    // ({0,1}) would make this test pass vacuously against verbatim carry.
    const RANGE = { min: 10, max: 60 };
    // Mirror of denormaliseValue's affine map: v → v·(max−min) + min.
    const dn = (v: number) => v * (RANGE.max - RANGE.min) + RANGE.min;
    const normContext = {
      goal_context: { range: RANGE },
    } as unknown as NonNullable<Parameters<typeof transformEdgeEValues>[2]>;
    const out = transformEdgeEValues(
      ISL_EDGE_E_VALUES as unknown as ISLEdgeEValue[],
      undefined,
      normContext,
    );

    // Sibling flip_mean is denormalised (pre-existing #227-era behaviour —
    // this is the reference space the band must share)…
    expect(out[0]!.flip_mean).toBe(dn(0.47)); // 33.5
    // …and the band receives EXACTLY the same affine map:
    const band = out[0]!.stability!;
    expect(band.band_min).toBe(dn(0.41));     // 30.5
    expect(band.band_median).toBe(dn(0.47));  // 33.5
    // Same input (0.47), same map ⇒ literally equal to the sibling flip_mean.
    expect(band.band_median).toBe(out[0]!.flip_mean);
    expect(band.band_max).toBe(dn(0.62));     // 41
    // band_width RECOMPUTED from the MAPPED endpoints — scale only, NO offset:
    // dn(0.62) − dn(0.41) = 0.21·50 = 10.5. An offset-mapped width
    // (dn(0.21) = 20.5) would be corrupt; pin against it explicitly.
    expect(band.band_width).toBe(dn(0.62) - dn(0.41));
    expect(band.band_width).toBeCloseTo(10.5, 10);
    expect(band.band_width).not.toBeCloseTo(dn(0.21), 10);
    // Null seed cells preserved AS NULL; non-null cells mapped:
    expect(band.seed_flip_means).toEqual([dn(0.41), null, dn(0.47), dn(0.62), null]);
    // Counts are space-invariant — untouched:
    expect(band.n_seeds).toBe(5);
    expect(band.n_seeds_flipped).toBe(3);
    // Positive control: the map genuinely moved every value.
    expect(band.band_min).not.toBe(FULL_BAND.band_min);
    expect(band.band_max).not.toBe(FULL_BAND.band_max);

    // Single-flip trap entry: the point band collapses to the mapped point;
    // zero width maps to zero width (offset corruption would read 10 here).
    const single = out[1]!.stability!;
    expect(single.band_min).toBe(dn(0.55));   // 37.5
    expect(single.band_median).toBe(dn(0.55));
    expect(single.band_max).toBe(dn(0.55));
    expect(single.band_width).toBe(0);
    expect(out[1]!.flip_mean).toBe(dn(0.55)); // band == flip_mean space
    expect(single.seed_flip_means).toEqual([null, null, dn(0.55), null, null]);
    expect(single.n_seeds_flipped).toBe(1);

    // No-flip entry: band_* keys stay ABSENT (nothing to map — never
    // fabricated), all-null seed cells stay null.
    const noFlip = out[2]!.stability as Record<string, unknown>;
    for (const k of ['band_min', 'band_median', 'band_max', 'band_width']) {
      expect(k in noFlip).toBe(false);
    }
    expect(noFlip.seed_flip_means).toEqual([null, null, null, null, null]);
    expect(noFlip.n_seeds_flipped).toBe(0);

    // Flag-off entry: still no stability key under normalisation.
    expect('stability' in out[3]!).toBe(false);
  });

  it('keeps bands VERBATIM on the _normalised:true path — flip_mean is verbatim there too (coherence, not transformation)', () => {
    // normContext active but goal range unavailable: flip_mean stays in
    // normalised space and the entry is flagged `_normalised: true`. Band and
    // sibling share ONE space (ISL flip-mean space) — the invariant is
    // coherence, so the band must stay verbatim here.
    const normContext = {
      goal_context: {},
    } as unknown as NonNullable<Parameters<typeof transformEdgeEValues>[2]>;
    const out = transformEdgeEValues(
      ISL_EDGE_E_VALUES as unknown as ISLEdgeEValue[],
      undefined,
      normContext,
    );
    expect(out[0]!.flip_mean).toBe(0.47);          // sibling verbatim
    expect(out[0]!._normalised).toBe(true);        // disclosed
    expect(out[0]!.stability).toEqual(FULL_BAND);  // band verbatim — same space
    expect(out[1]!.stability).toEqual(SINGLE_FLIP_BAND);
    expect(out[2]!.stability).toEqual(NO_FLIP_BAND);
  });

  it('numeric-egress guard still drops whole entries with non-finite numerics — stability rides, never rescues', () => {
    const poisoned = [
      { ...ISL_EDGE_E_VALUES[0], e_value: Number.NaN },
    ];
    const out = transformEdgeEValues(poisoned as unknown as ISLEdgeEValue[]);
    expect(out).toHaveLength(0);
  });
});

describe('lane 3 — /v2/run stability carry-through (route, end-to-end)', () => {
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
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 'lane3-stability-test' }),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('stability bands survive ISL → transformEdgeEValues → response wire VERBATIM', async () => {
    const body = await run();
    expect(Array.isArray(body.edge_e_values)).toBe(true);
    const byEdge = new Map<string, Record<string, unknown>>(
      body.edge_e_values.map((e: { edge_id: string }) => [e.edge_id, e]),
    );

    const full = byEdge.get('factor-a::goal');
    expect(full).toBeDefined();
    expect(full!.stability).toEqual(FULL_BAND);

    const singleFlip = byEdge.get('factor-b::goal');
    expect(singleFlip).toBeDefined();
    expect(singleFlip!.stability).toEqual(SINGLE_FLIP_BAND);

    const noFlip = byEdge.get('factor-c::goal');
    expect(noFlip).toBeDefined();
    expect(noFlip!.stability).toEqual(NO_FLIP_BAND);
    for (const k of ['band_min', 'band_median', 'band_max', 'band_width']) {
      expect(k in (noFlip!.stability as Record<string, unknown>)).toBe(false);
    }
  });

  it('flag-off shape: an entry without stability emits NO stability key on the wire (absent, not null)', async () => {
    const body = await run();
    const bare = body.edge_e_values.find((e: { edge_id: string }) => e.edge_id === 'factor-d::goal');
    expect(bare).toBeDefined();
    expect('stability' in bare).toBe(false);
  });

  it('under ACTIVE normalisation, egressed bands are mapped identically to flip_mean (A3 lane 4, end-to-end)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: NORM_GRAPH, options: NORM_OPTIONS, goal_node_id: 'goal', seed: 'lane4-units-test' }),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    const full = body.edge_e_values.find((e: { edge_id: string }) => e.edge_id === 'factor-a::goal');
    expect(full).toBeDefined();
    // Sibling flip_mean denormalised into the goal range (the reference space)…
    expect(full.flip_mean).toBe(dnGoal(0.47)); // 33.5
    // …and the band shares it exactly:
    expect(full.stability.band_min).toBe(dnGoal(0.41));
    expect(full.stability.band_median).toBe(full.flip_mean);
    expect(full.stability.band_max).toBe(dnGoal(0.62));
    // Recomputed width — scale only, no offset:
    expect(full.stability.band_width).toBe(dnGoal(0.62) - dnGoal(0.41));
    expect(full.stability.seed_flip_means).toEqual([dnGoal(0.41), null, dnGoal(0.47), dnGoal(0.62), null]);
    expect(full.stability.n_seeds).toBe(5);
    expect(full.stability.n_seeds_flipped).toBe(3);
    // Positive control: this wire genuinely differs from the ISL bytes.
    expect(full.stability.band_min).not.toBe(FULL_BAND.band_min);

    // No-flip entry: band_* stay absent even under the map.
    const noFlip = body.edge_e_values.find((e: { edge_id: string }) => e.edge_id === 'factor-c::goal');
    expect(noFlip).toBeDefined();
    for (const k of ['band_min', 'band_median', 'band_max', 'band_width']) {
      expect(k in noFlip.stability).toBe(false);
    }
    expect(noFlip.stability.seed_flip_means).toEqual([null, null, null, null, null]);

    // Flag-off entry: still no stability key.
    const bare = body.edge_e_values.find((e: { edge_id: string }) => e.edge_id === 'factor-d::goal');
    expect(bare).toBeDefined();
    expect('stability' in bare).toBe(false);
  });

  it('lane-1 envelope guard: stability-bearing body still parses — enrichment_contract_ok true', async () => {
    const body = await run();
    // Non-vacuous pairing: the band must actually be ON this wire…
    const full = body.edge_e_values.find((e: { edge_id: string }) => e.edge_id === 'factor-a::goal');
    expect(full?.stability).toEqual(FULL_BAND);
    // …and the egress guard must still assess the envelope as conformant
    // (AnalysisEnrichmentSchema is passthrough at every level — verified).
    expect(body._meta?.evidence?.enrichment_contract_ok).toBe(true);
    // No contract-mismatch warning either.
    const codes = (body.inference_warnings ?? []).map((w: { code: string }) => w.code);
    expect(codes).not.toContain('ENRICHMENT_CONTRACT_MISMATCH');
  });
});
