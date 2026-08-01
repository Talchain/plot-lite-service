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
 *
 * ⚠ THAT 2026-07-18 BLOCK IS HISTORY, AND IS KEPT AS A PINNED HISTORICAL
 * CONTROL — not as a description of the live wire (programme trap 12b: a
 * control pinned to "current" decays into a tautology the first time "current"
 * moves). ISL staging now advertises `v5-factor-flips-2026-08-01` with TWELVE
 * weights, SIX caps and a `formula_parameters` sibling. Sections G–K below add
 * the v5 estimator, its fail-closed contract, and the derived pins binding
 * PLoT's declaration to a dated capture of that live block (ROADMAP 2.260
 * step 3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateWeightedCostV2,
  estimateWeightedCostV5,
  planSampleDepth,
  applyComplexityBudget,
  resolveWeightedCostCeiling,
  PLOT_SAFETY_CEILING_COST_UNITS,
  LEGACY_BASE_N_SAMPLES,
  ADAPTIVE_N_SAMPLES_FLOOR,
  ISL_COMPLEXITY_BUDGET_DEFAULT,
  COMPLEXITY_FORMULA_WEIGHT_KEYS,
  COMPLEXITY_FORMULA_SPECS,
  KNOWN_COMPLEXITY_FORMULA_VERSIONS,
  V2_WEIGHTED_2026_07_WEIGHT_KEYS,
  V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS,
  V5_FACTOR_FLIPS_2026_08_01_CAP_KEYS,
  type WeightedCostRequest,
  type DepthPlanInput,
} from '../src/config/sampling.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
  ISLComputeAdmissionFormulaParameters,
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

/** The formula shape ISL staging advertises today. */
const V5_VERSION = 'v5-factor-flips-2026-08-01';

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

/**
 * The advertised per-term structural parameters. ISL PR #119 publishes the
 * sensitivity sub-sweep cap/divisor that PLoT used to HARD-CODE as
 * `min(100, ⌊S/10⌋)` in the estimator body (ROADMAP 2.260 step 3).
 *
 * ⚠ These are values, not shape: every arithmetic expectation below that
 * involves `min(100, ⌊S/10⌋)` is now reading THESE numbers, which is the point.
 */
const LIVE_FORMULA_PARAMETERS: ISLComputeAdmissionFormulaParameters = {
  sensitivity: { subsample_cap: 100, subsample_divisor: 10 },
};

function v2Admission(overrides: Partial<ISLComputeAdmission> = {}): ISLComputeAdmission {
  // Deep-copy weights/caps so a test that mutates a returned block cannot poison
  // the shared LIVE_WEIGHTS constant for later tests.
  return {
    max_cost_units: 24_000_000,
    complexity_formula_version: 'v2-weighted-2026-07',
    weights: { ...LIVE_WEIGHTS },
    caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 50 },
    formula_parameters: {
      sensitivity: { ...LIVE_FORMULA_PARAMETERS.sensitivity! },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The LIVE v5 advertisement (ROADMAP 2.260 step 3).
//
// ⚠ PROVENANCE — THIS IS A CAPTURE, NOT A HAND-WRITTEN GUESS. Taken by this
// lane from an unauthenticated `GET https://isl-staging.onrender.com/health` on
// 2026-08-01 AFTER ISL PR #119 deployed, `build_full`
// 1c9c7003186a8756695eae2077d0f5e70737e083, sampled 6 times consecutively with
// byte-identical results (programme trap 12c: a prompt/config read can differ
// per instance, so one sample is not evidence). The block is reproduced verbatim
// below, key for key and value for value.
//
// ⚠ AND IT IS DATED ON PURPOSE (trap 12b). A control pinned to "whatever is
// deployed now" decays into a tautology the first time "now" changes. This
// fixture is a snapshot of a specific ISL build; the ASSERTIONS below compare it
// against PLoT's own declared spec, so if the two ever disagree the test REDs
// and someone must look at the live wire again. It is never refreshed silently.
// ---------------------------------------------------------------------------

const LIVE_V5_WEIGHTS = {
  base_per_sample_per_option_per_struct: 1,
  evpi_sample_cap: 2000,
  evpc_coef: 1,
  evppi_full_coef: 1,
  evppi_null_permutations: 16,
  factor_flip_coef: 1,
  influence_walk_pool: 400_000,
  sensitivity_coef: 4,
  evalue_coef: 20,
  bands_coef: 200,
  path_coef: 1,
  max_decomposition_paths: 20_000,
} as unknown as ISLComputeAdmissionWeights;

const LIVE_V5_CAPS = {
  max_options: 10,
  max_nodes: 50,
  max_edges: 200,
  max_parameter_uncertainties: 50,
  max_control_candidates: 5,
  max_control_values: 7,
};

const LIVE_V5_FORMULA_PARAMETERS: ISLComputeAdmissionFormulaParameters = {
  factor_flips: { max_candidates: 10, stability_seeds: 10 },
  sensitivity: { subsample_cap: 100, subsample_divisor: 10 },
};

function v5Admission(overrides: Partial<ISLComputeAdmission> = {}): ISLComputeAdmission {
  return {
    max_cost_units: 24_000_000,
    complexity_formula_version: V5_VERSION,
    weights: { ...LIVE_V5_WEIGHTS },
    caps: { ...LIVE_V5_CAPS },
    formula_parameters: {
      factor_flips: { ...LIVE_V5_FORMULA_PARAMETERS.factor_flips! },
      sensitivity: { ...LIVE_V5_FORMULA_PARAMETERS.sensitivity! },
    },
    ...overrides,
  };
}

/** A base /v2/run-shaped request: voi + sensitivity + e-values + flips on, path off. */
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
    // PLoT sends include_factor_flips unconditionally (translator-v3.ts:634)
    // and no control_candidates at all — pinned in tests/isl-cost-request-shape.
    includeFactorFlips: true,
    controlGridPoints: 0,
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
    expect(estimateWeightedCostV2(baseReq(), LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS)).toBe(7_522_000);
  });

  it('prices EVPI with the (U+1)·min(S, evpi_sample_cap)·O·W term', () => {
    const req = baseReq({ nodeCount: 10, edgeCount: 20, optionCount: 2, uniqueParamUncertainties: 5 });
    // base 10000·2·30 = 600_000; evpi (5+1)·min(10000,2000)·2·30 = 720_000;
    // sensitivity 4·20·100·30 = 240_000; e 20·20·2=800; bands 200·20·2=8_000.
    expect(estimateWeightedCostV2(req, LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS)).toBe(1_568_800);
  });

  it('DERIVE-NOT-MIRROR: a changed sensitivity_coef changes the cost (coefficient is read, not hard-coded)', () => {
    const base = estimateWeightedCostV2(baseReq(), LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS);
    const doubled = estimateWeightedCostV2(baseReq(), { ...LIVE_WEIGHTS, sensitivity_coef: 8 }, LIVE_FORMULA_PARAMETERS);
    // sensitivity term = coef·100·100·150 = coef·1_500_000; doubling coef adds
    // exactly +6_000_000 — proves the estimator reads the advertised value.
    expect(doubled - base).toBe(6_000_000);
  });

  it('DERIVE-NOT-MIRROR: a changed evpi_sample_cap changes the EVPI cap used', () => {
    const req = baseReq({ optionCount: 2, uniqueParamUncertainties: 5 });
    const at2000 = estimateWeightedCostV2(req, LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS);
    const at5000 = estimateWeightedCostV2(req, { ...LIVE_WEIGHTS, evpi_sample_cap: 5000 }, LIVE_FORMULA_PARAMETERS);
    // evpi = 6·min(10000,cap)·O·W; W=150,O=2 → 6·cap·300. cap 2000→5000 adds
    // 6·3000·300 = 5_400_000. Proves the cap is read from the advertised weights.
    expect(at5000 - at2000).toBe(5_400_000);
  });

  it('path decomposition rides only when includePathDecomposition (bounded by max_decomposition_paths)', () => {
    const off = estimateWeightedCostV2(baseReq({ edgeCount: 200 }), LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS);
    const on = estimateWeightedCostV2(baseReq({ edgeCount: 200, includePathDecomposition: true }), LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS);
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
        estimateWeightedCostV2({ ...input, nSamples: s }, LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS);
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

  it("THE REAL DRIFT, replayed: ISL's v5 weight set under the OLD version names every coefficient v2 cannot price", () => {
    // ISL's v5 weights held under the v2 version string — exactly the dangerous
    // case: ISL adding cost terms WITHOUT renaming the formula. The version
    // string happens to catch that today; this asserts we are not relying on
    // luck.
    //
    // ⚠ ROADMAP 2.260 step 3 — THIS FIXTURE USED TO BE A HAND-COPIED 12-KEY
    // LITERAL, and both the key list and the 5 expected names were typed out by
    // hand. That is the mirror this file exists to argue against, sitting inside
    // the test that argues it: ISL PR #119 flagged it as already-stale. Both are
    // now DERIVED from the same declarations the estimator itself is bound by,
    // so the fixture cannot describe a v5 that PLoT does not implement.
    const block = v2Admission({ weights: { ...LIVE_V5_WEIGHTS } });
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);

    expect(r.status).toBe('unknown_weight_keys');
    expect(r.admission).toBeNull();

    const v2Keys = new Set<string>(V2_WEIGHTED_2026_07_WEIGHT_KEYS);
    const expectedUnexpected = [...V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS]
      .filter((k) => !v2Keys.has(k))
      .sort();
    // Positive control: the derivation must actually name something, or this
    // assertion would pass by comparing two empty lists.
    expect(expectedUnexpected.length).toBeGreaterThan(0);
    expect(r.unexpectedWeightKeys).toEqual(expectedUnexpected);
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

  it('FOREIGN GROUP fires its OWN loud warning + its OWN metric, and does NOT touch the skew counter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const block = v5Admission();
    (block.formula_parameters as unknown as Record<string, unknown>).evpc = { grid_stride: 2 };
    mockHealth({ status: 'healthy', compute_admission: block });
    const r = await __refreshForTest();

    // ADMITTED — the advisory must not cost the depth.
    expect(r.status).toBe('ok');
    expect(r.skew).toBe(false);
    expect(r.admission).not.toBeNull();

    // ...but LOUD, and diagnosable without a source dive: it names the group.
    expect(warn).toHaveBeenCalled();
    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('isl_admission_foreign_formula_parameter_groups');
    expect(warned).toContain('evpc');

    const rendered = renderHistograms();
    expect(rendered).toContain(
      'plot_engine_isl_admission_foreign_formula_parameter_groups_total',
    );
    // ⚠ THE SEPARATION IS THE ASSERTION. Folding an ADMITTED state into a
    // counter named "version_skew_total" would make that alarm mean two
    // different things, and would break the post-deploy check that the skew
    // counter stops incrementing. A counter that means two things is a counter
    // nobody can act on.
    expect(rendered).not.toContain('plot_engine_isl_admission_version_skew_total{reason=');
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
    const baseline = estimateWeightedCostV2(req, LIVE_WEIGHTS, LIVE_FORMULA_PARAMETERS);

    for (const key of V2_WEIGHTED_2026_07_WEIGHT_KEYS) {
      const perturbed = {
        ...LIVE_WEIGHTS,
        [key]: (LIVE_WEIGHTS as unknown as Record<string, number>)[key] / 2,
      } as unknown as ISLComputeAdmissionWeights;
      expect(
        estimateWeightedCostV2(req, perturbed, LIVE_FORMULA_PARAMETERS),
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

    const cost = estimateWeightedCostV2(allTermsLiveReq(), recording, LIVE_FORMULA_PARAMETERS);
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

// ===========================================================================
// G. ROADMAP 2.260 step 3 — the v5 estimator, and the FAIL-CLOSED contract
//
// ISL advertises `v5-factor-flips-2026-08-01`, whose cost model carries four
// terms v2 never priced. PLoT under-counted the true cost by 43% on a typical
// graph (measure-2260-skew-fallback.md §6.2), so the version stayed unadmitted
// and EVERY defaulted analysis silently ran at 4,000 samples instead of 10,000.
//
// Admitting it safely needs two numbers ISL did not publish until PR #119
// (the factor-flip candidate cap and stability-seed count) plus two the
// estimator used to HARD-CODE (the sensitivity sub-sweep cap and divisor).
// PLoT reads all four at runtime and refuses to price v5 without them.
// ===========================================================================

describe('estimateWeightedCostV5 — mirrors ISL compute_weighted_cost @ PR #119 aba52131', () => {
  it('prices the measured 2.258-class graph term by term', () => {
    // The graph from measure-2260-skew-fallback.md §6.2: N=10, E=12, O=3, U=4,
    // W=22, S=10,000, K=16, C=10, B=10, flips on, path decomposition off, no
    // control grid.
    //
    //   base_mc      1·10000·3·22                          =   660,000
    //   evpi         (4+1)·min(10000,2000)·3·22            =   660,000
    //   evppi_full   1·4·(1+16)·10000                      =   680,000
    //   sensitivity  4·12·min(100,1000)·22                 =   105,600
    //   influence    400,000 (flat)                        =   400,000
    //   e-values     20·12·3 = 720; bands 200·12·3 = 7,200 =     7,920
    //   factor_flips 1·3·(1+20+2·10·(2+10))·22             =    17,226
    //                                                       ---------
    //                                                        2,530,746
    //
    // ⚠ CORRECTION TO THE MEASUREMENT, DISCLOSED. measure-2260-skew-fallback.md
    // §6.2 published this total as 2,514,906. That figure priced factor_flips at
    // **C = 0** — and said so, explicitly, as its one unverified residue: "the
    // factor_flips term's C and B sub-parameters are not derivable from /health;
    // I priced it at C=0". They were not derivable then; ISL PR #119 advertises
    // them now, and at the real C=10 the term is 17,226 rather than 1,386. The
    // true cost is therefore 15,840 HIGHER than recorded.
    //
    // The measurement's conclusion is untouched, exactly as it predicted ("no
    // plausible value changes the conclusion"): 2,530,746 against the live
    // 24,000,000 ceiling is still 9.48× of headroom, so the defaulted depth
    // still returns to 10,000 on this graph class. Recording the delta because a
    // number that moved must not be left reading as if it had not.
    const req = baseReq({
      nSamples: 10_000,
      nodeCount: 10,
      edgeCount: 12,
      optionCount: 3,
      uniqueParamUncertainties: 4,
    });
    expect(estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS)).toBe(2_530_746);
  });

  it('THE 43% GAP: v5 prices the same graph strictly higher than v2 — the under-count that made admitting v5 unsafe', () => {
    const req = baseReq({
      nSamples: 10_000,
      nodeCount: 10,
      edgeCount: 12,
      optionCount: 3,
      uniqueParamUncertainties: 4,
    });
    const v2 = estimateWeightedCostV2(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    const v5 = estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    // The measurement's arm-B figure for the v2 estimator on this graph —
    // unchanged, because v2 never priced the term whose parameter moved.
    expect(v2).toBe(1_433_520);
    expect(v5).toBe(2_530_746);
    // 1,097,226 of cost v2 could not see — 43.4% of the true total.
    expect(v5 - v2).toBe(1_097_226);
    expect((v5 - v2) / v5).toBeGreaterThan(0.42);
    // And the whole point: the true cost still fits the live ceiling with room,
    // so admitting v5 RESTORES the full depth rather than forcing a reduction.
    expect(v5).toBeLessThan(24_000_000);
  });

  it('the factor-flips term reads C and B from formula_parameters (NOT hard-coded)', () => {
    const req = baseReq({ nodeCount: 10, edgeCount: 12, optionCount: 3, uniqueParamUncertainties: 4 });
    const base = estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    // Raise ONLY the candidate cap C: 10 -> 20. flips = coef·O·(1+2N+2C(O-1+B))·W
    // = 1·3·(1+20+2C·12)·22. C 10->20 adds 3·(2·10·12)·22 = 15,840.
    const moreCandidates = estimateWeightedCostV5(
      req,
      LIVE_V5_WEIGHTS,
      { ...LIVE_V5_FORMULA_PARAMETERS, factor_flips: { max_candidates: 20, stability_seeds: 10 } },
    );
    expect(moreCandidates - base).toBe(15_840);

    // Raise ONLY the stability seeds B: 10 -> 12. adds 3·(2·10·2)·22 = 2,640.
    const moreSeeds = estimateWeightedCostV5(
      req,
      LIVE_V5_WEIGHTS,
      { ...LIVE_V5_FORMULA_PARAMETERS, factor_flips: { max_candidates: 10, stability_seeds: 12 } },
    );
    expect(moreSeeds - base).toBe(2_640);
  });

  it('the sensitivity sub-sweep reads cap/divisor from formula_parameters (the retired hard-coded literal)', () => {
    // sampling.ts used to hard-code `Math.min(100, Math.floor(S / 10))`. Both
    // numbers now come off the wire; changing either must move the cost.
    const req = baseReq({ nodeCount: 10, edgeCount: 12, optionCount: 3, uniqueParamUncertainties: 4 });
    const base = estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);

    // cap 100 -> 200: min(200, 1000) = 200, so the term doubles. 4·12·100·22.
    const biggerCap = estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, {
      ...LIVE_V5_FORMULA_PARAMETERS,
      sensitivity: { subsample_cap: 200, subsample_divisor: 10 },
    });
    expect(biggerCap - base).toBe(105_600);

    // divisor 10 -> 1000: min(100, 10) = 10, so the term falls to a tenth.
    const biggerDivisor = estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, {
      ...LIVE_V5_FORMULA_PARAMETERS,
      sensitivity: { subsample_cap: 100, subsample_divisor: 1000 },
    });
    expect(base - biggerDivisor).toBe(95_040);
  });

  it("EVPPI is O-flat and structural influence is a FLAT charge — ISL's two easiest terms to get wrong", () => {
    const one = baseReq({ nodeCount: 10, edgeCount: 12, optionCount: 1, uniqueParamUncertainties: 4 });
    const two = { ...one, optionCount: 2 };
    const dOptions =
      estimateWeightedCostV5(two, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS) -
      estimateWeightedCostV5(one, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    // Going 1 -> 2 options moves ONLY the terms that carry an O factor:
    //   base_mc  1·10000·22 per option              = 220,000
    //   evpi     (4+1)·2000·22 per option           = 220,000
    //   e-values 20·12 = 240; bands 200·12 = 2,400  =   2,640
    //   flips    1·22·(O·(21 + 20·(O−1+10))):
    //            O=1 -> 221·22 = 4,862; O=2 -> 482·22 = 10,604 = 5,742
    //                                                 ---------
    //                                                   448,382
    // evppi_full (680,000 here) and structural_influence (400,000) contribute
    // NOTHING, which is the assertion: had either been given an O factor — the
    // natural mistake, since every neighbouring term has one — this exact
    // equality would fail by that term's whole value.
    expect(dOptions).toBe(448_382);
    // Structural influence is charged once, flat, when sensitivity runs and U>0.
    const noFactors = baseReq({ nodeCount: 10, edgeCount: 12, optionCount: 3, uniqueParamUncertainties: 0 });
    const withFactors = { ...noFactors, uniqueParamUncertainties: 1 };
    const delta =
      estimateWeightedCostV5(withFactors, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS) -
      estimateWeightedCostV5(noFactors, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    // evpi (1+1)·2000·3·22 = 264,000; evppi 1·1·17·10000 = 170,000;
    // influence flat 400,000. Total 834,000.
    expect(delta).toBe(834_000);
  });

  it('structural influence is gated on SENSITIVITY and U>0 — NOT on include_voi (a different gate from EVPI)', () => {
    // ISL robustness_analyzer_v2.py:557-559. Getting this gate wrong under-prices
    // a flat 400,000 whenever a caller turns include_voi off.
    const noVoi = baseReq({
      nodeCount: 10,
      edgeCount: 12,
      optionCount: 3,
      uniqueParamUncertainties: 4,
      includeVoi: false,
    });
    const noVoiNoSens = { ...noVoi, includeSensitivity: false };
    const delta =
      estimateWeightedCostV5(noVoi, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS) -
      estimateWeightedCostV5(noVoiNoSens, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    // sensitivity 4·12·100·22 = 105,600 PLUS the flat influence pool 400,000 —
    // the influence term rides even though include_voi is false.
    expect(delta).toBe(505_600);
  });

  it('EVPC is priced off the control grid alone, NOT gated on include_voi', () => {
    // ISL :539-541. PLoT sends no control_candidates today (grid 0), but the
    // coefficient IS advertised, so the term must exist the moment one is sent.
    const noGrid = baseReq({ nodeCount: 10, edgeCount: 12, optionCount: 3, includeVoi: false });
    const withGrid = { ...noGrid, controlGridPoints: 3 };
    const delta =
      estimateWeightedCostV5(withGrid, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS) -
      estimateWeightedCostV5(noGrid, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    // evpc_coef·S·W·grid = 1·10000·22·3 = 660,000, with include_voi false.
    expect(delta).toBe(660_000);
  });
});

// ===========================================================================
// H. FAIL CLOSED — v5 is never priced from a number ISL has not published
// ===========================================================================

describe('fail-closed: an incomplete advertisement leaves v5 UNADMITTED', () => {
  it('THE DEPLOY-ORDER PIN: a v5 block with NO formula_parameters is skew, and NAMES what it is waiting for', () => {
    // This is not hypothetical — it is exactly the block isl-staging served
    // earlier on 2026-08-01, before PR #119 deployed (captured by this lane:
    // v5, 12 weights, 6 caps, no formula_parameters). A PLoT carrying this code
    // deployed ahead of ISL reads that block and lands here. THAT is what makes
    // the deploy order a safety margin rather than a correctness requirement.
    const block = v5Admission();
    delete (block as { formula_parameters?: unknown }).formula_parameters;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);

    expect(r.status).toBe('missing_formula_parameters');
    expect(r.skew).toBe(true);
    expect(r.admission).toBeNull();
    expect(r.missingFormulaParameters).toEqual([
      'factor_flips.max_candidates',
      'factor_flips.stability_seeds',
      'sensitivity.subsample_cap',
      'sensitivity.subsample_divisor',
    ]);
  });

  it('a SINGLE missing parameter is enough to keep v5 unadmitted (no partial pricing)', () => {
    const block = v5Admission();
    delete (block.formula_parameters!.factor_flips as { stability_seeds?: number }).stability_seeds;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('missing_formula_parameters');
    expect(r.missingFormulaParameters).toEqual(['factor_flips.stability_seeds']);
  });

  it('a NON-FINITE parameter is treated as missing, not coerced', () => {
    const block = v5Admission();
    (block.formula_parameters!.sensitivity as unknown as Record<string, unknown>).subsample_cap =
      'one hundred';
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('missing_formula_parameters');
    expect(r.missingFormulaParameters).toEqual(['sensitivity.subsample_cap']);
  });

  it('planSampleDepth RE-GUARDS: handed an unpriceable v5 block directly, it falls back conservatively', () => {
    // planSampleDepth is exported and takes an admission argument, so it must not
    // trust that its caller ran the resolver. Belt-and-braces with classify().
    const block = v5Admission();
    delete (block as { formula_parameters?: unknown }).formula_parameters;
    // The 2.258-class graph the measurement used, so the scalar budget cannot
    // also bite and confuse which mechanism produced the number: this is the
    // raise-disable alone, and 4,000 is exactly the depth arm A measured live.
    const input = planInput({ nodeCount: 10, edgeCount: 12, optionCount: 3, uniqueParamUncertainties: 4 });
    const d = planSampleDepth(input, block, { conservative: true });
    expect(d.mode).toBe('legacy_fallback');
    // And the depth loss is still DISCLOSED (PR #302), not silent.
    expect(d.kind).toBe('reduced');
    if (d.kind === 'reduced') {
      expect(d.nSamples).toBe(LEGACY_BASE_N_SAMPLES);
      expect(d.originalNSamples).toBe(10_000);
      expect(d.reason).toBe('admission_unavailable');
    }
  });

  it('ACCEPTANCE: the SAME graph with the COMPLETE live advertisement plans the full 10,000', () => {
    // The pair. Everything held constant except whether ISL published the four
    // parameters — which is precisely the difference ISL PR #119 made.
    const input = planInput({ nodeCount: 10, edgeCount: 12, optionCount: 3, uniqueParamUncertainties: 4 });
    const d = planSampleDepth(input, v5Admission(), { conservative: false });
    expect(d.mode).toBe('weighted');
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') {
      expect(d.nSamples).toBe(10_000);
      expect(d.cost).toBe(2_530_746);
      expect(d.ceiling).toBe(24_000_000);
    }
  });

  it('an ADVERTISED parameter PLoT does not price is skew (a term whose shape grew)', () => {
    const block = v5Admission();
    (block.formula_parameters!.sensitivity as unknown as Record<string, unknown>).subsample_floor = 5;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('unknown_formula_parameters');
    expect(r.unexpectedFormulaParameters).toEqual(['sensitivity.subsample_floor']);
  });

  it('a WHOLE FOREIGN GROUP is ADMITTED with a loud advisory — NOT skew (the depth must survive it)', () => {
    // ⚠ THIS ASSERTION WAS DELIBERATELY INVERTED, and the reasoning matters more
    // than the assertion. The first cut of this PR treated a foreign group as
    // skew, symmetrically with an in-group parameter. Adversarial review
    // overturned it on evidence from this repo's own dependency: ISL PR #119
    // added `formula_parameters` as a NEW SIBLING under an UNCHANGED version
    // string. That class of change WILL recur — a third group, an advisory
    // group, a v6 pre-advertisement.
    //
    // Under the old behaviour, that recurrence would take a HEALTHY, fully
    // priceable advertisement and drop every defaulted analysis back to 4,000
    // AND disable all six structural cap pre-checks (skew nulls the admission;
    // checkAdmissionCaps returns `ok` on null). Depth AND caps — a strictly
    // worse blast radius than the residual it bought, and the residual is
    // already covered: a genuinely new cost TERM also carries a `weights`
    // coefficient and trips unknown_weight_keys (below).
    const block = v5Admission();
    (block.formula_parameters as unknown as Record<string, unknown>).evpc = { grid_stride: 2 };
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);

    expect(r.status).toBe('ok');
    expect(r.skew).toBe(false);
    expect(r.admission).not.toBeNull();
    // Admitted, but NAMED — silence here would be the 2.260 defect again.
    expect(r.foreignFormulaParameterGroups).toEqual(['evpc']);
  });

  it('a foreign group still plans the FULL depth — the whole point of not skewing on it', () => {
    const block = v5Admission();
    (block.formula_parameters as unknown as Record<string, unknown>).evpc = { grid_stride: 2 };
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    const input = planInput({
      nodeCount: 10,
      edgeCount: 12,
      optionCount: 3,
      uniqueParamUncertainties: 4,
    });
    const d = planSampleDepth(input, r.admission, { conservative: r.skew });
    expect(d.mode).toBe('weighted');
    expect(d.kind).toBe('unchanged');
    if (d.kind === 'unchanged') expect(d.nSamples).toBe(10_000);
  });

  it('THE RESIDUAL IS COVERED: a foreign group that signals a REAL new term still skews, via its weight key', () => {
    // The safety argument for admitting foreign groups rests on this: every v5
    // cost term reads at least one `weights` coefficient, so a group that
    // accompanies a genuine new term cannot slip through silently — the weight
    // key trips first. If this ever REDs, the asymmetry above loses its
    // justification and must be revisited.
    const block = v5Admission();
    (block.formula_parameters as unknown as Record<string, unknown>).some_new_phase = { k: 2 };
    (block.weights as unknown as Record<string, unknown>).some_new_phase_coef = 3;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('unknown_weight_keys');
    expect(r.skew).toBe(true);
    expect(r.admission).toBeNull();
    expect(r.unexpectedWeightKeys).toEqual(['some_new_phase_coef']);
  });
});

// ===========================================================================
// I. The CAP_KEYS mirror, retired (ROADMAP 2.260 — PR #302 bycatch)
// ===========================================================================

describe('cap keys are version-derived, not a fixed four-element list', () => {
  it("v5's SIX advertised caps all validate — the old CAP_KEYS list knew only four", () => {
    const r = __classifyForTest({ compute_admission: v5Admission() } as ISLHealthResponse);
    expect(r.status).toBe('ok');
    expect(r.admission?.caps.max_control_candidates).toBe(5);
    expect(r.admission?.caps.max_control_values).toBe(7);
  });

  it('a MISSING cap this version pre-checks is missing_block (garbled), like a missing coefficient', () => {
    const block = v5Admission();
    delete (block.caps as { max_control_values?: number }).max_control_values;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('missing_block');
    expect(r.admission).toBeNull();
  });

  it('an UNKNOWN advertised cap is SKEW and is NAMED — ISL grew a structural constraint PLoT cannot pre-check', () => {
    const block = v5Admission();
    (block.caps as unknown as Record<string, unknown>).max_correlations = 12;
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('unknown_cap_keys');
    expect(r.skew).toBe(true);
    expect(r.admission).toBeNull();
    expect(r.unexpectedCapKeys).toEqual(['max_correlations']);
  });

  it("THE REAL CAP DRIFT, replayed: v5's six caps under the v2 version name the two v2 cannot check", () => {
    // The bycatch PR #302 flagged: `CAP_KEYS` was fixed at four while ISL's v5
    // block advertises six, so max_control_candidates / max_control_values were
    // validated by nothing and enforced by nothing. Derived, not hand-listed.
    const block = v2Admission({ caps: { ...LIVE_V5_CAPS } });
    const r = __classifyForTest({ compute_admission: block } as ISLHealthResponse);
    expect(r.status).toBe('unknown_cap_keys');
    expect(r.unexpectedCapKeys).toEqual(['max_control_candidates', 'max_control_values']);
  });
});

// ===========================================================================
// J. The v5 spec is bound to the LIVE advertisement, both ways (deliverable 5)
// ===========================================================================

describe('the v5 declaration matches what ISL actually advertises', () => {
  it('the captured LIVE weight key set equals the set the v5 estimator declares', () => {
    // Both sides derived: the fixture is a verbatim /health capture, the
    // expectation is the same declaration planSampleDepth dispatches on. If ISL
    // and PLoT ever disagree about which coefficients exist, this REDs.
    expect(Object.keys(LIVE_V5_WEIGHTS).sort()).toEqual(
      [...V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS].sort(),
    );
    expect([...(COMPLEXITY_FORMULA_WEIGHT_KEYS.get(V5_VERSION) ?? [])].sort()).toEqual(
      Object.keys(LIVE_V5_WEIGHTS).sort(),
    );
  });

  it('the captured LIVE cap key set equals the set the v5 caps gate declares', () => {
    expect(Object.keys(LIVE_V5_CAPS).sort()).toEqual([...V5_FACTOR_FLIPS_2026_08_01_CAP_KEYS].sort());
  });

  it('the captured LIVE formula_parameters match the per-term parameters the v5 estimator declares', () => {
    const spec = COMPLEXITY_FORMULA_SPECS.get(V5_VERSION)!;
    const declared = [...spec.formulaParameters]
      .flatMap(([term, names]) => [...names].map((n) => `${term}.${n}`))
      .sort();
    const advertised = Object.entries(
      LIVE_V5_FORMULA_PARAMETERS as unknown as Record<string, Record<string, number>>,
    )
      .flatMap(([term, group]) => Object.keys(group).map((n) => `${term}.${n}`))
      .sort();
    expect(declared.length).toBeGreaterThan(0); // positive control
    expect(advertised).toEqual(declared);
  });

  it('the WHOLE captured live block classifies ok — no leftover corner keeps v5 unadmitted', () => {
    const r = __classifyForTest({ compute_admission: v5Admission() } as ISLHealthResponse);
    expect(r.status).toBe('ok');
    expect(r.skew).toBe(false);
    expect(r.advertisedVersion).toBe(V5_VERSION);
    expect(r.admission).not.toBeNull();
  });

  it('KNOWN_COMPLEXITY_FORMULA_VERSIONS now contains v5, still derived from the spec map', () => {
    expect(KNOWN_COMPLEXITY_FORMULA_VERSIONS.has(V5_VERSION)).toBe(true);
    expect([...KNOWN_COMPLEXITY_FORMULA_VERSIONS].sort()).toEqual(
      [...COMPLEXITY_FORMULA_SPECS.keys()].sort(),
    );
  });
});

// ===========================================================================
// K. The two-direction coefficient pins, for v5 (same mechanisms as v2)
// ===========================================================================

describe('COMPLEXITY_FORMULA_SPECS — v5 declared ⇔ read, both directions', () => {
  /** A request shaped so EVERY v5 term is live, including EVPC and path decomp. */
  function allV5TermsLiveReq(): WeightedCostRequest {
    return baseReq({
      nSamples: 10_000,
      nodeCount: 50,
      edgeCount: 200,
      optionCount: 2,
      uniqueParamUncertainties: 3,
      includePathDecomposition: true,
      includeFactorFlips: true,
      controlGridPoints: 4,
    });
  }

  it('DIRECTION 1 (declared ⇒ read): every declared v5 key actually moves the cost', () => {
    const req = allV5TermsLiveReq();
    const baseline = estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);
    for (const key of V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS) {
      const perturbed = {
        ...LIVE_V5_WEIGHTS,
        [key]: (LIVE_V5_WEIGHTS as unknown as Record<string, number>)[key] / 2,
      } as unknown as ISLComputeAdmissionWeights;
      expect(
        estimateWeightedCostV5(req, perturbed, LIVE_V5_FORMULA_PARAMETERS),
        `weight key "${key}" is declared but does not move the cost — the declared set and estimateWeightedCostV5 have drifted`,
      ).not.toBe(baseline);
    }
  });

  it('DIRECTION 2 (read ⇒ declared): the v5 estimator reads NO coefficient outside the declared set', () => {
    // The direction a perturbation loop cannot see, and the more dangerous one:
    // an UNDECLARED read is never validated as finite. Five of v5's twelve keys
    // are optional on the TS type, so this is not theoretical here.
    const reads = new Set<string>();
    const recording = new Proxy(LIVE_V5_WEIGHTS as unknown as Record<string, unknown>, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') reads.add(prop);
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as ISLComputeAdmissionWeights;

    const cost = estimateWeightedCostV5(allV5TermsLiveReq(), recording, LIVE_V5_FORMULA_PARAMETERS);
    expect(reads.size).toBeGreaterThan(0); // positive control
    expect(Number.isFinite(cost)).toBe(true);

    const declared = new Set<string>(V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS);
    expect(
      [...reads].filter((k) => !declared.has(k)).sort(),
      'estimateWeightedCostV5 reads a coefficient that is not declared — it would be unvalidated, and undefined at runtime',
    ).toEqual([]);
  });

  it('DIRECTION 2, for PARAMETERS: the v5 estimator reads no formula_parameter outside the declared set', () => {
    // The same argument one layer down. A parameter read but not declared is
    // never checked for presence, so it resolves to undefined -> NaN cost while
    // the block still classifies ok.
    const reads = new Set<string>();
    const recordGroup = (term: string, group: Record<string, number>) =>
      new Proxy(group, {
        get(target, prop, receiver) {
          if (typeof prop === 'string') reads.add(`${term}.${prop}`);
          return Reflect.get(target, prop, receiver);
        },
      });
    const recording = {
      factor_flips: recordGroup('factor_flips', { max_candidates: 10, stability_seeds: 10 }),
      sensitivity: recordGroup('sensitivity', { subsample_cap: 100, subsample_divisor: 10 }),
    } as unknown as ISLComputeAdmissionFormulaParameters;

    const cost = estimateWeightedCostV5(allV5TermsLiveReq(), LIVE_V5_WEIGHTS, recording);
    expect(reads.size).toBeGreaterThan(0); // positive control
    expect(Number.isFinite(cost)).toBe(true);

    const spec = COMPLEXITY_FORMULA_SPECS.get(V5_VERSION)!;
    const declared = new Set(
      [...spec.formulaParameters].flatMap(([term, names]) => [...names].map((n) => `${term}.${n}`)),
    );
    expect(
      [...reads].filter((k) => !declared.has(k)).sort(),
      'estimateWeightedCostV5 reads a formula parameter that is not declared — it would be unvalidated, and undefined at runtime',
    ).toEqual([]);
  });
});
