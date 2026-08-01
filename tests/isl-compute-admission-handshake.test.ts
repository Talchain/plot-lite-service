/**
 * Codex F8 handshake — PLoT read-side of the ISL /health compute-admission
 * capability (Option B): derive-don't-mirror, version-keyed weighted planning,
 * fail-loud conservative fallback on skew.
 *
 * ISL advertises its LIVE weighted admission cost model on /health
 * (`compute_admission`, formula `v2-weighted-2026-07`). PLoT reads it, prices a
 * request with the ADVERTISED weights, and plans sample depth against
 * `min(safety, live max_cost_units)`. If the handshake is unavailable or the
 * formula version is unknown, PLoT falls back to a conservative legacy scalar
 * bound (base depth capped at 4,000) and emits a loud skew warning + metric.
 *
 * Live-verified ISL advertisement (isl-staging /health, 2026-07-18):
 *   max_cost_units 24_000_000, version "v2-weighted-2026-07",
 *   weights { base_per_sample_per_option_per_struct 1, evpi_sample_cap 2000,
 *     sensitivity_coef 4, evalue_coef 20, bands_coef 200, path_coef 1,
 *     max_decomposition_paths 20000 },
 *   caps { max_options 10, max_nodes 50, max_edges 200, max_parameter_uncertainties 50 }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateWeightedCostV2,
  planSampleDepth,
  applyComplexityBudget,
  resolveWeightedCostCeiling,
  PLOT_SAFETY_CEILING_COST_UNITS,
  LEGACY_BASE_N_SAMPLES,
  ADAPTIVE_N_SAMPLES_FLOOR,
  ISL_COMPLEXITY_BUDGET_DEFAULT,
  COMPLEXITY_FORMULA_WEIGHT_KEYS,
  KNOWN_COMPLEXITY_FORMULA_VERSIONS,
  V2_WEIGHTED_2026_07_WEIGHT_KEYS,
  type WeightedCostRequest,
  type DepthPlanInput,
} from '../src/config/sampling.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
  ISLHealthResponse,
} from '../src/integrations/isl/types/isl-types.js';
import {
  __classifyForTest,
  __refreshForTest,
  __resetIslComputeAdmission,
  __setIslComputeAdmissionForTest,
  getIslComputeAdmission,
} from '../src/integrations/isl/compute-admission.js';
import {
  initializeHistograms,
  renderHistograms,
  resetHistograms,
} from '../src/metrics/registry.js';

// ---------------------------------------------------------------------------
// Fixtures — the LIVE advertised weights/caps (v2-weighted-2026-07).
// ---------------------------------------------------------------------------

const LIVE_WEIGHTS: ISLComputeAdmissionWeights = {
  base_per_sample_per_option_per_struct: 1,
  evpi_sample_cap: 2000,
  sensitivity_coef: 4,
  evalue_coef: 20,
  bands_coef: 200,
  path_coef: 1,
  max_decomposition_paths: 20000,
};

function v2Admission(overrides: Partial<ISLComputeAdmission> = {}): ISLComputeAdmission {
  // Deep-copy weights/caps so a test that mutates a returned block cannot poison
  // the shared LIVE_WEIGHTS constant for later tests.
  return {
    max_cost_units: 24_000_000,
    complexity_formula_version: 'v2-weighted-2026-07',
    weights: { ...LIVE_WEIGHTS },
    caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 50 },
    ...overrides,
  };
}

/** A base /v2/run-shaped request: voi + sensitivity + e-values on, path off. */
function baseReq(o: Partial<WeightedCostRequest> = {}): WeightedCostRequest {
  return {
    nSamples: 10_000,
    nodeCount: 50,
    edgeCount: 100,
    optionCount: 1,
    uniqueParamUncertainties: 0,
    includeVoi: true,
    includeSensitivity: true,
    includeEValues: true,
    includePathDecomposition: false,
    ...o,
  };
}

function planInput(o: Partial<DepthPlanInput> = {}): DepthPlanInput {
  return { ...baseReq(o), nSamplesExplicit: false, ...o } as DepthPlanInput;
}

// ===========================================================================
// A. estimateWeightedCostV2 consumes the ADVERTISED weights (not hard-coded)
// ===========================================================================

describe('estimateWeightedCostV2 — mirrors ISL compute_weighted_cost, reads advertised weights', () => {
  it('prices the base /v2/run shape exactly (50n/100e/1opt/0factor/10000s)', () => {
    // base 1·10000·1·150 = 1_500_000; sensitivity 4·100·min(100,1000)·150 =
    // 6_000_000; e-values 20·100·1 = 2_000; bands 200·100·1 = 20_000; no EVPI
    // (U=0). Total 7_522_000.
    expect(estimateWeightedCostV2(baseReq(), LIVE_WEIGHTS)).toBe(7_522_000);
  });

  it('prices EVPI with the (U+1)·min(S, evpi_sample_cap)·O·W term', () => {
    const req = baseReq({ nodeCount: 10, edgeCount: 20, optionCount: 2, uniqueParamUncertainties: 5 });
    // base 10000·2·30 = 600_000; evpi (5+1)·min(10000,2000)·2·30 = 720_000;
    // sensitivity 4·20·100·30 = 240_000; e 20·20·2=800; bands 200·20·2=8_000.
    expect(estimateWeightedCostV2(req, LIVE_WEIGHTS)).toBe(1_568_800);
  });

  it('DERIVE-NOT-MIRROR: a changed sensitivity_coef changes the cost (coefficient is read, not hard-coded)', () => {
    const base = estimateWeightedCostV2(baseReq(), LIVE_WEIGHTS);
    const doubled = estimateWeightedCostV2(baseReq(), { ...LIVE_WEIGHTS, sensitivity_coef: 8 });
    // sensitivity term = coef·100·100·150 = coef·1_500_000; doubling coef adds
    // exactly +6_000_000 — proves the estimator reads the advertised value.
    expect(doubled - base).toBe(6_000_000);
  });

  it('DERIVE-NOT-MIRROR: a changed evpi_sample_cap changes the EVPI cap used', () => {
    const req = baseReq({ optionCount: 2, uniqueParamUncertainties: 5 });
    const at2000 = estimateWeightedCostV2(req, LIVE_WEIGHTS);
    const at5000 = estimateWeightedCostV2(req, { ...LIVE_WEIGHTS, evpi_sample_cap: 5000 });
    // evpi = 6·min(10000,cap)·O·W; W=150,O=2 → 6·cap·300. cap 2000→5000 adds
    // 6·3000·300 = 5_400_000. Proves the cap is read from the advertised weights.
    expect(at5000 - at2000).toBe(5_400_000);
  });

  it('path decomposition rides only when includePathDecomposition (bounded by max_decomposition_paths)', () => {
    const off = estimateWeightedCostV2(baseReq({ edgeCount: 200 }), LIVE_WEIGHTS);
    const on = estimateWeightedCostV2(baseReq({ edgeCount: 200, includePathDecomposition: true }), LIVE_WEIGHTS);
    // E·E = 40_000 > max_decomposition_paths 20_000 → term = path_coef·20_000.
    expect(on - off).toBe(20_000);
  });
});

// ===========================================================================
// B. Weighted planning — happy path (NO over-reduction) + defect positive control
// ===========================================================================

describe('planSampleDepth (weighted) — happy path does not over-reduce', () => {
  it('50n/100e/10000s (1 option, no factors) passes at FULL depth against the 24M ceiling', () => {
    const d = planSampleDepth(planInput(), v2Admission());
    expect(d.mode).toBe('weighted');
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') {
      expect(d.nSamples).toBe(10_000);
      expect(d.cost).toBe(7_522_000);
      expect(d.cost).toBeLessThanOrEqual(d.ceiling);
    }
  });

  it('POSITIVE CONTROL (the defect): the OLD scalar mirror WOULD over-reduce the same graph', () => {
    // 10000 × 50 × 100 = 50_000_000 > 30M scalar default → cut to floor(30M/5000).
    const scalar = applyComplexityBudget(10_000, 50, 100);
    expect(scalar.kind).toBe('reduced');
    if (scalar.kind === 'reduced') {
      expect(scalar.nSamples).toBe(6_000); // needless quality loss the weighted plan avoids
      expect(scalar.complexity).toBeGreaterThan(ISL_COMPLEXITY_BUDGET_DEFAULT);
    }
  });

  it('the effective ceiling is min(safety, live) — live 24M governs below the 30M safety belt', () => {
    expect(resolveWeightedCostCeiling(24_000_000)).toBe(24_000_000);
    // A garbage/absurd advertised ceiling is capped by PLoT safety belt.
    expect(resolveWeightedCostCeiling(9_999_999_999)).toBe(PLOT_SAFETY_CEILING_COST_UNITS);
  });
});

describe('planSampleDepth (weighted) — reduction + refusal fit the live gate', () => {
  it('reduces to the maximal honest depth when the weighted cost exceeds the ceiling', () => {
    // 50n/100e/2opt/30factor: cost@10000 ≈ 27.6M > 24M.
    const input = planInput({ optionCount: 2, uniqueParamUncertainties: 30 });
    const d = planSampleDepth(input, v2Admission());
    expect(d.mode).toBe('weighted');
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.nSamples).toBeGreaterThanOrEqual(ADAPTIVE_N_SAMPLES_FLOOR);
      expect(d.nSamples).toBeLessThan(10_000);
      // Maximal: the reduced depth fits, one sample more would breach the ceiling.
      const costAt = (s: number) =>
        estimateWeightedCostV2({ ...input, nSamples: s }, LIVE_WEIGHTS);
      expect(costAt(d.nSamples)).toBeLessThanOrEqual(d.ceiling);
      expect(costAt(d.nSamples + 1)).toBeGreaterThan(d.ceiling);
    }
  });

  it('refuses (GRAPH_TOO_COMPLEX) when even the floor depth exceeds the ceiling', () => {
    // 50n/100e/10opt/49factor: EVPI alone at floor 1000 ≈ 75M ≫ 24M.
    const input = planInput({ optionCount: 10, uniqueParamUncertainties: 49 });
    const d = planSampleDepth(input, v2Admission());
    expect(d.kind).toBe('refused');
    if (d.kind === 'refused') {
      expect(d.mode).toBe('weighted');
      expect(d.costAtFloor).toBeGreaterThan(d.ceiling);
    }
  });
});

// ===========================================================================
// C. Fail-loud fallback — skew / unreachable → conservative legacy scalar @ 4000
// ===========================================================================

describe('planSampleDepth — fail-loud conservative fallback (admission null)', () => {
  it('DISABLES the depth-raise: a DEFAULTED 10000 plans at the legacy 4000 base — AS A VISIBLE REDUCTION', () => {
    // Small graph: no BUDGET reduction is needed; the only effect is the raise
    // being off. ⚠ ROADMAP 2.260 — this assertion previously read
    // `expect(d.kind).toBe('unchanged')`, which is precisely how a 60% cut in
    // Monte Carlo depth stayed invisible: the route only surfaces
    // SAMPLES_REDUCED_FOR_COMPLEXITY on a `reduced` decision, so 'unchanged'
    // laundered the cut into silence. The DEPTH is unchanged from before (4000);
    // what changed is that the loss is now REPORTED.
    const d = planSampleDepth(planInput({ nodeCount: 3, edgeCount: 3, optionCount: 1 }), null);
    expect(d.mode).toBe('legacy_fallback');
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.nSamples).toBe(LEGACY_BASE_N_SAMPLES); // 4000, not 10000
      // The TRUE pre-cap depth — not the already-capped intermediate the scalar
      // budget saw, which is what used to reach the response.
      expect(d.originalNSamples).toBe(10_000);
      // The cause is the SEAM, not the caller's graph.
      expect(d.reason).toBe('admission_unavailable');
    }
  });

  it('a DEFAULTED depth already at/below the legacy base is NOT reported as reduced (no phantom warning)', () => {
    // Guards the other direction: the disclosure must fire on a real loss only.
    const d = planSampleDepth(
      planInput({ nodeCount: 3, edgeCount: 3, optionCount: 1, nSamples: LEGACY_BASE_N_SAMPLES }),
      null,
    );
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') expect(d.nSamples).toBe(LEGACY_BASE_N_SAMPLES);
  });

  it('attributes a BUDGET-only reduction to the budget, not to the seam', () => {
    // Non-conservative fallback (ISL unconfigured / cold warm-up): the raise is
    // NOT disabled, so any reduction is a genuine property of the graph.
    const d = planSampleDepth(planInput({ nodeCount: 50, edgeCount: 100 }), null, {
      conservative: false,
    });
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.originalNSamples).toBe(10_000);
      expect(d.reason).toBe('admission_budget');
    }
  });

  it('a conservative reduction STACKED on the raise-disable still reports the TRUE original depth', () => {
    // 50n/100e defaulted → capped to 4000, then the 10M scalar bound reduces to
    // 2000. The user asked for 10000: that is the number the disclosure must
    // name, not the 4000 intermediate.
    const d = planSampleDepth(planInput({ nodeCount: 50, edgeCount: 100 }), null);
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.nSamples).toBe(2_000);
      expect(d.originalNSamples).toBe(10_000);
      expect(d.reason).toBe('admission_unavailable');
    }
  });

  it('POSITIVE CONTROL: the SAME small graph WITH a valid admission keeps the full 10000', () => {
    const d = planSampleDepth(planInput({ nodeCount: 3, edgeCount: 3, optionCount: 1 }), v2Admission());
    expect(d.mode).toBe('weighted');
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') expect(d.nSamples).toBe(10_000);
  });

  it('applies the conservative 10M scalar bound (not 30M) on the fallback path', () => {
    // 50n/100e defaulted → planned 4000; 4000×5000 = 20M > 10M → reduced to
    // floor(10M/5000) = 2000. (Under the old 30M it would NOT have reduced.)
    const d = planSampleDepth(planInput({ nodeCount: 50, edgeCount: 100 }), null);
    expect(d.mode).toBe('legacy_fallback');
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') expect(d.nSamples).toBe(2_000);
  });

  it('an EXPLICIT caller depth is NOT capped to 4000 on the fallback path', () => {
    const d = planSampleDepth(
      planInput({ nodeCount: 3, edgeCount: 3, nSamples: 8000, nSamplesExplicit: true }),
      null,
    );
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') expect(d.nSamples).toBe(8000);
  });
});

// ===========================================================================
// D. Resolver classify + version guard
// ===========================================================================

describe('compute-admission classify — version guard', () => {
  it('classifies a live v2 block as ok', () => {
    const r = __classifyForTest({ compute_admission: v2Admission() } as ISLHealthResponse);
    expect(r.status).toBe('ok');
    expect(r.skew).toBe(false);
    expect(r.admission).not.toBeNull();
  });

  it('classifies an UNKNOWN future formula version as skew (fail loud, no admission)', () => {
    const r = __classifyForTest({
      compute_admission: v2Admission({ complexity_formula_version: 'v9-future' }),
    } as ISLHealthResponse);
    expect(r.status).toBe('unknown_version');
    expect(r.skew).toBe(true);
    expect(r.admission).toBeNull();
    expect(r.advertisedVersion).toBe('v9-future');
  });

  it('classifies an unreachable /health (null) as unreachable skew', () => {
    const r = __classifyForTest(null);
    expect(r.status).toBe('unreachable');
    expect(r.skew).toBe(true);
  });

  it('classifies a health payload with no compute_admission block as missing_block skew', () => {
    const r = __classifyForTest({ status: 'healthy' } as ISLHealthResponse);
    expect(r.status).toBe('missing_block');
    expect(r.skew).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ROADMAP 2.260 — the DERIVED drift alarm on advertised weight keys.
  //
  // The version string catches a formula ISL RENAMES. It cannot catch a formula
  // ISL GROWS IN PLACE: same version, one more coefficient, and PLoT would price
  // the request with a term missing — under-counting the true cost and turning a
  // safe conservative fallback into a confident plan ISL refuses with a raw 422.
  // These pin the derived guard: the expected key set comes from
  // COMPLEXITY_FORMULA_WEIGHT_KEYS, never from a remembered list.
  // -------------------------------------------------------------------------

  it('UNKNOWN ADVERTISED WEIGHT KEY: same version + an unpriced coefficient is SKEW, not silently ignored', () => {
    const block = v2Admission();
    (block.weights as unknown as Record<string, unknown>).factor_flip_coef = 1;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);

    expect(r.status).toBe('unknown_weight_keys');
    expect(r.skew).toBe(true);
    // The version stays UNADMITTED — planning against a formula we cannot price
    // is the failure mode this guard exists to prevent.
    expect(r.admission).toBeNull();
    // The drift is NAMED, so one log line is enough to diagnose it.
    expect(r.unexpectedWeightKeys).toEqual(['factor_flip_coef']);
  });

  it("THE REAL DRIFT, replayed: ISL's live v5 weight set under a KNOWN version names all 5 unpriced coefficients", () => {
    // The 12 keys ISL staging actually advertises (live /health, 2026-08-01,
    // matching ISL source tip 29cb4e27 build_compute_admission). Held here under
    // the v2 version string to simulate exactly the dangerous case: ISL adding
    // its four new cost terms WITHOUT renaming the formula. Today the version
    // string happens to catch it; this asserts we are not relying on that luck.
    const block = v2Admission({
      weights: {
        base_per_sample_per_option_per_struct: 1,
        evpi_sample_cap: 2000,
        evpc_coef: 1,
        evppi_full_coef: 1,
        evppi_null_permutations: 16,
        factor_flip_coef: 1,
        influence_walk_pool: 400000,
        sensitivity_coef: 4,
        evalue_coef: 20,
        bands_coef: 200,
        path_coef: 1,
        max_decomposition_paths: 20000,
      } as unknown as ISLComputeAdmissionWeights,
    });
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);

    expect(r.status).toBe('unknown_weight_keys');
    expect(r.admission).toBeNull();
    expect(r.unexpectedWeightKeys).toEqual([
      'evpc_coef',
      'evppi_full_coef',
      'evppi_null_permutations',
      'factor_flip_coef',
      'influence_walk_pool',
    ]);
  });

  it('POSITIVE CONTROL: the EXACT advertised key set still resolves ok (the guard is not blanket-rejecting)', () => {
    const r = __classifyForTest({ compute_admission: v2Admission() } as ISLHealthResponse);
    expect(r.status).toBe('ok');
    expect(r.admission).not.toBeNull();
    expect(r.unexpectedWeightKeys).toBeUndefined();
  });

  it('a MISSING priced coefficient is missing_block (garbled), not unknown_weight_keys (drifted)', () => {
    const block = v2Admission();
    delete (block.weights as unknown as Record<string, unknown>).bands_coef;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('missing_block');
    expect(r.admission).toBeNull();
  });

  it('classifies a MALFORMED block (non-finite weight) as missing_block skew', () => {
    const bad = v2Admission();
    (bad.weights as unknown as Record<string, unknown>).sensitivity_coef = 'oops';
    const r = __classifyForTest({ compute_admission: bad } as ISLHealthResponse);
    expect(r.status).toBe('missing_block');
    expect(r.skew).toBe(true);
  });
});

// ===========================================================================
// E. Resolver refresh — fail-loud warning + metric fire on skew (full loop)
// ===========================================================================

describe('compute-admission refresh — loud warning + metric on skew', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    __resetIslComputeAdmission();
    process.env.ISL_BASE_URL = 'https://isl.test';
    process.env.ISL_API_KEY = 'k';
    process.env.PROMETHEUS_ENABLE = '1';
    initializeHistograms();
    resetHistograms();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetIslComputeAdmission();
    process.env = { ...prevEnv };
  });

  function mockHealth(body: unknown | null, ok = true): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (body === null && !ok) throw new Error('ECONNREFUSED');
        return { ok, json: async () => body } as unknown as Response;
      }),
    );
  }

  it('happy path: a live v2 /health resolves ok with NO skew warning/metric', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHealth({ status: 'healthy', compute_admission: v2Admission() });
    const r = await __refreshForTest();
    expect(r.status).toBe('ok');
    expect(r.admission?.max_cost_units).toBe(24_000_000);
    expect(warn).not.toHaveBeenCalled();
    expect(renderHistograms()).not.toContain('isl_admission_version_skew_total{reason=');
  });

  it('version SKEW: v9-future fires the loud warning AND increments the metric', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHealth({ status: 'healthy', compute_admission: v2Admission({ complexity_formula_version: 'v9-future' }) });
    const r = await __refreshForTest();

    expect(r.status).toBe('unknown_version');
    expect(r.skew).toBe(true);
    expect(r.admission).toBeNull();

    // POSITIVE CONTROL — the warning fires with the skew event...
    expect(warn).toHaveBeenCalled();
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('isl_admission_version_skew');
    expect(warned).toContain('v9-future');
    // ...and the metric increments for reason=unknown_version.
    expect(renderHistograms()).toContain(
      'plot_engine_isl_admission_version_skew_total{reason="unknown_version"} 1',
    );
  });

  it('WEIGHT-KEY SKEW fires the loud warning naming the unpriced coefficients AND its own metric label', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const block = v2Admission();
    (block.weights as unknown as Record<string, unknown>).evppi_full_coef = 1;
    mockHealth({ status: 'healthy', compute_admission: block });
    const r = await __refreshForTest();

    expect(r.status).toBe('unknown_weight_keys');
    expect(r.skew).toBe(true);
    expect(r.admission).toBeNull();

    expect(warn).toHaveBeenCalled();
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('isl_admission_version_skew');
    expect(warned).toContain('unknown_weight_keys');
    // The alarm must be diagnosable without a source dive: it names the key.
    expect(warned).toContain('evppi_full_coef');

    expect(renderHistograms()).toContain(
      'plot_engine_isl_admission_version_skew_total{reason="unknown_weight_keys"} 1',
    );
  });

  it('unreachable /health fires the metric with reason=unreachable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockHealth(null, false);
    const r = await __refreshForTest();
    expect(r.status).toBe('unreachable');
    expect(renderHistograms()).toContain(
      'plot_engine_isl_admission_version_skew_total{reason="unreachable"} 1',
    );
  });

  it('ISL disabled (no base URL) falls back QUIETLY — no skew warning/metric', async () => {
    delete process.env.ISL_BASE_URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await __refreshForTest();
    expect(r.status).toBe('disabled');
    expect(r.skew).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(renderHistograms()).not.toContain('isl_admission_version_skew_total{reason=');
  });
});

// ===========================================================================
// E2. The version guard is DERIVED, not a second hand-maintained list
// ===========================================================================

describe('COMPLEXITY_FORMULA_WEIGHT_KEYS — one source of truth for the version guard', () => {
  it('KNOWN_COMPLEXITY_FORMULA_VERSIONS is derived from the map (a version cannot be added without its key set)', () => {
    // If these ever diverge, someone has reintroduced a second list — the exact
    // hand-maintained-mirror defect this map exists to make inexpressible.
    expect([...KNOWN_COMPLEXITY_FORMULA_VERSIONS].sort()).toEqual(
      [...COMPLEXITY_FORMULA_WEIGHT_KEYS.keys()].sort(),
    );
  });

  it("the v2 key set matches what ISL's v2 formula advertises — no more, no less", () => {
    expect([...(COMPLEXITY_FORMULA_WEIGHT_KEYS.get('v2-weighted-2026-07') ?? [])].sort()).toEqual(
      Object.keys(LIVE_WEIGHTS).sort(),
    );
  });

  // A request shaped so EVERY term of the v2 formula is live: E·E (40,000)
  // exceeds max_decomposition_paths, and S exceeds evpi_sample_cap. Shared by
  // the two directional pins below so neither can silently exercise less of the
  // formula than the other.
  function allTermsLiveReq(): WeightedCostRequest {
    return baseReq({
      nSamples: 10_000,
      nodeCount: 50,
      edgeCount: 200,
      optionCount: 2,
      uniqueParamUncertainties: 3,
      includePathDecomposition: true,
    });
  }

  it('DIRECTION 1 (declared ⇒ read): every declared key actually moves the cost', () => {
    // Catches a coefficient PLoT demands as finite but never prices — the
    // advertisement would be rejected for a key that changes nothing.
    const req = allTermsLiveReq();
    const baseline = estimateWeightedCostV2(req, LIVE_WEIGHTS);

    for (const key of V2_WEIGHTED_2026_07_WEIGHT_KEYS) {
      const perturbed = {
        ...LIVE_WEIGHTS,
        [key]: (LIVE_WEIGHTS as unknown as Record<string, number>)[key] / 2,
      } as unknown as ISLComputeAdmissionWeights;
      expect(
        estimateWeightedCostV2(req, perturbed),
        `weight key "${key}" is declared but does not move the cost — the declared set and the estimator body have drifted`,
      ).not.toBe(baseline);
    }
  });

  it('DIRECTION 2 (read ⇒ declared): the estimator reads NO coefficient outside the declared set', () => {
    // The direction the perturbation loop above CANNOT see, and the more
    // dangerous one: a term added to estimateWeightedCostV2 reading an
    // UNDECLARED coefficient. validWeightsForVersion only checks declared keys,
    // so the read yields `undefined` -> NaN cost -> a plan built on NaN, with
    // the block still classified `ok`. Recording the actual property reads is
    // the only way to pin it; a value-based assertion cannot.
    const reads = new Set<string>();
    const recording = new Proxy(LIVE_WEIGHTS as unknown as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') reads.add(prop);
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as ISLComputeAdmissionWeights;

    const cost = estimateWeightedCostV2(allTermsLiveReq(), recording);
    // Positive control: the recorder must have SEEN something, and the cost must
    // be a real number — otherwise this assertion passes by observing nothing.
    expect(reads.size).toBeGreaterThan(0);
    expect(Number.isFinite(cost)).toBe(true);

    const declared = new Set<string>(V2_WEIGHTED_2026_07_WEIGHT_KEYS);
    expect(
      [...reads].filter((k) => !declared.has(k)).sort(),
      'estimateWeightedCostV2 reads a coefficient that is not declared — it would be unvalidated, and undefined at runtime',
    ).toEqual([]);
  });
});

// ===========================================================================
// F. Synchronous cache — non-blocking, TTL-bounded, seedable
// ===========================================================================

describe('getIslComputeAdmission — synchronous cache', () => {
  afterEach(() => __resetIslComputeAdmission());

  it('serves a seeded fresh capability synchronously (no network)', () => {
    __setIslComputeAdmissionForTest({ admission: v2Admission(), skew: false, status: 'ok' });
    const r = getIslComputeAdmission();
    expect(r.status).toBe('ok');
    expect(r.admission?.complexity_formula_version).toBe('v2-weighted-2026-07');
  });

  it('cold cache returns the conservative warming fallback (non-blocking first request)', () => {
    __resetIslComputeAdmission();
    delete process.env.ISL_BASE_URL; // keep the background refresh a no-op/disabled
    const r = getIslComputeAdmission();
    expect(r.admission).toBeNull();
    expect(r.skew).toBe(false); // warming is NOT an alarm
  });
});
