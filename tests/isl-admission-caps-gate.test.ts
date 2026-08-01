/**
 * Codex F8 handshake — the CAPS half. Completes the /health capability handshake
 * that #233 opened (which fitted sample depth to the advertised COST ceiling).
 *
 * ISL advertises structural caps on /health (`compute_admission.caps`:
 * max_nodes / max_edges / max_options / max_parameter_uncertainties) SPECIFICALLY
 * so PLoT can pre-check them and refuse BEFORE calling ISL. Before this gate a
 * request UNDER the cost ceiling but OVER a structural cap — most importantly
 * `max_parameter_uncertainties=50`, for which PLoT has NO other check — was
 * forwarded and came back a raw Pydantic 422 ("List should have at most 50
 * items"), the exact passthrough the handshake exists to prevent.
 *
 * DERIVE-DON'T-MIRROR (trap #12): parameter_uncertainties has no PLoT LIMITS
 * twin (advertised cap is the sole gate); nodes/edges/options are checked
 * against min(PLoT LIMITS, advertised cap) so an ISL-tightened cap bites here
 * while PLoT's LIMITS stay the belt-and-braces lower bound.
 *
 * Live-verified advertisement (isl-staging /health, 2026-07-18):
 *   caps { max_options 10, max_nodes 50, max_edges 200, max_parameter_uncertainties 50 }
 */

import { describe, it, expect } from 'vitest';
import {
  checkAdmissionCaps,
  planSampleDepth,
  type AdmissionCapsInput,
  type StructuralSafetyLimits,
  type DepthPlanInput,
  type WeightedCostRequest,
} from '../src/config/sampling.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
} from '../src/integrations/isl/types/isl-types.js';

// ---------------------------------------------------------------------------
// Fixtures — the LIVE advertised weights/caps (v2-weighted-2026-07) + PLoT LIMITS.
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
  return {
    max_cost_units: 24_000_000,
    complexity_formula_version: 'v2-weighted-2026-07',
    weights: { ...LIVE_WEIGHTS },
    caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 50 },
    formula_parameters: { sensitivity: { subsample_cap: 100, subsample_divisor: 10 } },
    ...overrides,
  };
}

/** PLoT's production LIMITS (schemas 0.15.0): nodes 50 / edges 100 / options 10. */
const PLOT_LIMITS: StructuralSafetyLimits = { maxNodes: 50, maxEdges: 100, maxOptions: 10 };

function capsInput(o: Partial<AdmissionCapsInput> = {}): AdmissionCapsInput {
  return { nodeCount: 10, edgeCount: 10, optionCount: 1, uniqueParamUncertainties: 0, ...o };
}

function baseReq(o: Partial<WeightedCostRequest> = {}): WeightedCostRequest {
  return {
    nSamples: 10_000,
    nodeCount: 10,
    edgeCount: 10,
    optionCount: 1,
    uniqueParamUncertainties: 0,
    includeVoi: true,
    includeSensitivity: true,
    includeEValues: true,
    includePathDecomposition: false,
    // v5 (ROADMAP 2.260 step 3): PLoT sends include_factor_flips unconditionally
    // and no control_candidates — pinned in tests/isl-cost-request-shape.test.ts.
    includeFactorFlips: true,
    controlGridPoints: 0,
    ...o,
  };
}

function planInput(o: Partial<DepthPlanInput> = {}): DepthPlanInput {
  return { ...baseReq(o), nSamplesExplicit: false, ...o } as DepthPlanInput;
}

// ===========================================================================
// A. The un-checkable dimension — max_parameter_uncertainties (the core gap)
// ===========================================================================

describe('checkAdmissionCaps — parameter_uncertainties (the genuinely un-checkable cap)', () => {
  it('POSITIVE CONTROL (the passthrough gap): a >50-PU graph UNDER the cost ceiling PASSES the depth planner — it would reach ISL and 422', () => {
    // 10n/10e/1opt/51-PU @10000s: cost ≈ 2.36M ≪ 24M ceiling → the COST gate
    // admits it at full depth (never refuses/reduces), i.e. PLoT would forward
    // it to ISL, which rejects it with a raw Pydantic 422 (>50 PUs). This is the
    // exact seam the caps half closes.
    const plan = planSampleDepth(planInput({ uniqueParamUncertainties: 51 }), v2Admission());
    expect(plan.mode).toBe('weighted');
    expect(plan.kind).toBe('unchanged'); // NOT refused/reduced — the cost gate lets it through
  });

  it('THE FIX: the caps gate refuses the SAME >50-PU graph, naming the cap + observed/limit (no ISL call)', () => {
    const d = checkAdmissionCaps(capsInput({ uniqueParamUncertainties: 51 }), v2Admission(), PLOT_LIMITS);
    expect(d.kind).toBe('exceeded');
    if (d.kind === 'exceeded') {
      expect(d.dimension).toBe('parameter_uncertainties');
      expect(d.observed).toBe(51);
      expect(d.limit).toBe(50);
      expect(d.source).toBe('isl_cap');
    }
  });

  it('exactly AT the cap (50) admits — strictly-greater-than, matching ISL "at most 50"', () => {
    const d = checkAdmissionCaps(capsInput({ uniqueParamUncertainties: 50 }), v2Admission(), PLOT_LIMITS);
    expect(d.kind).toBe('ok');
  });

  it('DERIVE-NOT-MIRROR: an ISL-tightened PU cap (5) bites even at 10 PUs — PLoT reads the advertised value', () => {
    const tightened = v2Admission({
      caps: { max_options: 10, max_nodes: 50, max_edges: 200, max_parameter_uncertainties: 5 },
    });
    const d = checkAdmissionCaps(capsInput({ uniqueParamUncertainties: 10 }), tightened, PLOT_LIMITS);
    expect(d.kind).toBe('exceeded');
    if (d.kind === 'exceeded') {
      expect(d.dimension).toBe('parameter_uncertainties');
      expect(d.limit).toBe(5);
    }
  });
});

// ===========================================================================
// B. Structural dimensions — enforced at min(PLoT LIMITS, advertised cap)
// ===========================================================================

describe('checkAdmissionCaps — nodes/edges/options at min(LIMITS, advertised cap)', () => {
  it('PLoT LIMITS is the belt-and-braces floor: 120 edges breach min(100, 200)=100 via plot_limit', () => {
    // ISL advertises max_edges 200, but PLoT LIMITS is 100 → the min (100) binds.
    const d = checkAdmissionCaps(capsInput({ edgeCount: 120 }), v2Admission(), PLOT_LIMITS);
    expect(d.kind).toBe('exceeded');
    if (d.kind === 'exceeded') {
      expect(d.dimension).toBe('edges');
      expect(d.limit).toBe(100);
      expect(d.source).toBe('plot_limit');
    }
  });

  it('an ISL-tightened cap BELOW PLoT LIMITS bites: caps.max_nodes 20 refuses 30 nodes via isl_cap', () => {
    const tightened = v2Admission({
      caps: { max_options: 10, max_nodes: 20, max_edges: 200, max_parameter_uncertainties: 50 },
    });
    const d = checkAdmissionCaps(capsInput({ nodeCount: 30 }), tightened, PLOT_LIMITS);
    expect(d.kind).toBe('exceeded');
    if (d.kind === 'exceeded') {
      expect(d.dimension).toBe('nodes');
      expect(d.limit).toBe(20);
      expect(d.source).toBe('isl_cap');
    }
  });

  it('options over min(LIMITS 10, cap 10) breach', () => {
    const d = checkAdmissionCaps(capsInput({ optionCount: 11 }), v2Admission(), PLOT_LIMITS);
    expect(d.kind).toBe('exceeded');
    if (d.kind === 'exceeded') expect(d.dimension).toBe('options');
  });

  it('PU is checked FIRST: a graph over BOTH PU and edges names parameter_uncertainties', () => {
    const d = checkAdmissionCaps(
      capsInput({ uniqueParamUncertainties: 51, edgeCount: 999 }),
      v2Admission(),
      PLOT_LIMITS,
    );
    expect(d.kind).toBe('exceeded');
    if (d.kind === 'exceeded') expect(d.dimension).toBe('parameter_uncertainties');
  });
});

// ===========================================================================
// C. No regression + no spurious refusal (skew / no-caps fallback)
// ===========================================================================

describe('checkAdmissionCaps — within-caps admits; skew/no-caps does NOT spuriously refuse', () => {
  it('a graph WITHIN every cap admits (no regression)', () => {
    const d = checkAdmissionCaps(
      capsInput({ nodeCount: 50, edgeCount: 100, optionCount: 10, uniqueParamUncertainties: 50 }),
      v2Admission(),
      PLOT_LIMITS,
    );
    expect(d.kind).toBe('ok');
  });

  it('SKEW / no-caps (admission null) does NOT refuse — even a wildly over-cap graph passes the caps gate', () => {
    // Version skew, ISL unconfigured, or the cold warm-up all resolve admission
    // to null. The caps gate must NOT invent a refusal there (the cost-gate
    // conservative fallback governs instead) — matching planSampleDepth.
    const d = checkAdmissionCaps(
      capsInput({ nodeCount: 999, edgeCount: 999, optionCount: 999, uniqueParamUncertainties: 999 }),
      null,
      PLOT_LIMITS,
    );
    expect(d.kind).toBe('ok');
  });
});
