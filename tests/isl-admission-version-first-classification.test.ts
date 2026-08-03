/**
 * ROADMAP 2.356 (PLoT half) — the #305 residuals: a READABLE advertised version
 * must survive sibling-field validation, and "we cannot price ISL's gate" must
 * never be answered with blind scalar arithmetic.
 *
 * ── RESIDUAL 1: THE DRIFT/OUTAGE DISCRIMINATOR IS EVALUATED TOO LATE ────────
 *
 * #305 established the right rule and stated it in the source: an OUTAGE-class
 * skew (no readable formula version) may retain the last-known-good
 * advertisement, because the last verified block is almost certainly still
 * ISL's real gate; a DRIFT-class skew (a READABLE version PLoT cannot price)
 * must NEVER retain, because live ISL is positively declaring a different cost
 * model and the retained block is obsolete pricing with stale caps.
 *
 * The discriminator is `advertisedVersion === undefined`. But `classify()`
 * runs `validAdmissionShape()` — which checks `weights`/`caps`/`max_cost_units`
 * — BEFORE it reads `complexity_formula_version`, and that early return carries
 * NO `advertisedVersion`. So a block whose version is perfectly readable but
 * whose siblings are garbled is reported as if no version had been advertised
 * at all, and takes the OUTAGE branch.
 *
 * The concrete case, which is not hypothetical — it is exactly the shape of a
 * partially-rolled-out ISL: `{complexity_formula_version: 'v9-future',
 * weights: null, caps: {...}}`. ISL is telling PLoT, in plain text, that it is
 * running a formula PLoT has never heard of. PLoT answers by pricing the
 * request with the RETAINED v5 weights, at full depth, with v5's structural
 * caps, and logs `advertised_version: null` — so the one field an operator
 * would use to diagnose it is blank.
 *
 * ⚠ The source comment at the retention site records the accepted edge as
 * "garbled weights under a readable version land conservative — the safe
 * side". That is true when `weights` is an OBJECT missing keys (it passes the
 * shape gate, the version resolves, `validWeightsForVersion` fails, and the
 * resolution keeps `advertisedVersion`). It is FALSE when `weights` is a
 * non-object, which fails the shape gate first. The ruling was right; its
 * implementation has a hole one type-check wide.
 *
 * ── RESIDUAL 2: THE SCALAR FALLBACK CANNOT SEE THE GATE IT IS GUARDING ──────
 *
 * `sampling.ts` already says it plainly: "NO scalar arithmetic can promise
 * admission against a weighted gate it cannot see." The 2.289 witness pinned in
 * `isl-admission-unknown-honest-fallback.test.ts` shows the capped 4,000-sample
 * fallback still pricing at 29.4M against a 24M ceiling. This file adds the
 * probe from the other direction — a graph whose scalar cost is TINY (3.2M,
 * comfortably inside every scalar budget) while its true v5 cost is 29.39M,
 * over the ceiling — and pins the fix: when ISL is configured but its gate is
 * unreadable, PLoT takes ONE bounded synchronous refresh and then REFUSES with
 * a typed, truthful code, rather than forwarding a request it has no basis to
 * believe ISL will admit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  estimateWeightedCostV5,
  estimateWeightedCostV6,
  COMPLEXITY_FORMULA_SPECS,
  KNOWN_COMPLEXITY_FORMULA_VERSIONS,
  LEGACY_FALLBACK_SCALAR_BUDGET,
  ISL_COMPLEXITY_BUDGET_DEFAULT,
  LEGACY_BASE_N_SAMPLES,
  type WeightedCostRequest,
} from '../src/config/sampling.js';
import {
  __classifyForTest,
  __refreshForTest,
  __resetIslComputeAdmission,
  resolveAdmissionForPlanning,
  type AdmissionResolution,
} from '../src/integrations/isl/compute-admission.js';
import { ISLClient } from '../src/integrations/isl/client.js';
import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
  ISLComputeAdmissionFormulaParameters,
  ISLHealthResponse,
} from '../src/integrations/isl/types/isl-types.js';

const V5_VERSION = 'v5-factor-flips-2026-08-01';

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

const LIVE_V5_FORMULA_PARAMETERS: ISLComputeAdmissionFormulaParameters = {
  factor_flips: { max_candidates: 10, stability_seeds: 10 },
  sensitivity: { subsample_cap: 100, subsample_divisor: 10 },
};

const V5_CAPS = {
  max_options: 10,
  max_nodes: 50,
  max_edges: 200,
  max_parameter_uncertainties: 50,
  max_control_candidates: 5,
  max_control_values: 7,
};

function v5Admission(): ISLComputeAdmission {
  return {
    max_cost_units: 24_000_000,
    complexity_formula_version: V5_VERSION,
    weights: { ...LIVE_V5_WEIGHTS },
    caps: { ...V5_CAPS },
    formula_parameters: {
      factor_flips: { ...LIVE_V5_FORMULA_PARAMETERS.factor_flips! },
      sensitivity: { ...LIVE_V5_FORMULA_PARAMETERS.sensitivity! },
    },
  } as ISLComputeAdmission;
}

function health(block: unknown): ISLHealthResponse {
  return { status: 'healthy', compute_admission: block } as unknown as ISLHealthResponse;
}

/**
 * ISL mid-rollout: a version PLoT has never seen, advertised in plain text,
 * with siblings PLoT cannot use. The DRIFT signal is unmistakable to a human
 * reading the payload — which is the whole point.
 */
function futureVersionGarbledSiblings(): unknown {
  return {
    max_cost_units: 24_000_000,
    complexity_formula_version: 'v9-future',
    weights: null,
    caps: { ...V5_CAPS },
  };
}

/**
 * ISL-configured state is derived from env by `isISLConfigured()` (client.ts),
 * so it is set the way the rest of this suite sets it — via the environment,
 * not by spying on an ESM live binding.
 */
function configureIsl(on: boolean): void {
  if (on) {
    process.env.ISL_BASE_URL = 'https://isl.test';
    process.env.ISL_API_KEY = 'k';
  } else {
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_API_KEY;
  }
}

const prevEnv = { ...process.env };

beforeEach(() => {
  __resetIslComputeAdmission();
  vi.restoreAllMocks();
  configureIsl(true);
});

afterEach(() => {
  __resetIslComputeAdmission();
  vi.restoreAllMocks();
  process.env = { ...prevEnv };
});

// ===========================================================================
// A. Residual 1 — the version must be extracted and classified FIRST.
// ===========================================================================

describe('2.356 — a readable advertised version survives garbled siblings', () => {
  it('classifies a readable FUTURE version as unknown_version, not as a versionless missing_block', () => {
    const r = __classifyForTest(health(futureVersionGarbledSiblings()));

    // The version was right there in the payload; the resolution must carry it,
    // both for the operator-facing alarm and for the retention discriminator.
    expect(r.advertisedVersion).toBe('v9-future');
    expect(r.skew).toBe(true);
    expect(r.status).toBe('unknown_version');
  });

  it('does NOT retain the stale v5 admission when live ISL declares a version it cannot price', async () => {
    // 1) A healthy v5 read establishes the last-known-good.
    const healthy = vi
      .spyOn(ISLClient.prototype, 'fetchHealth')
      .mockResolvedValue(health(v5Admission()));
    configureIsl(true);
    const ok = await __refreshForTest();
    expect(ok.status).toBe('ok');
    expect(ok.admission).not.toBeNull();

    // 2) ISL rolls forward to a formula PLoT cannot price, with unusable siblings.
    healthy.mockResolvedValue(health(futureVersionGarbledSiblings()));
    const drifted = await __refreshForTest();

    // DRIFT never retains — this is the #305 ruling, and the shape gate must not
    // be able to launder a drift into an outage.
    expect(drifted.advertisedVersion).toBe('v9-future');
    expect(drifted.retainedAdmissionVersion).toBeUndefined();
    expect(drifted.admission).toBeNull();
  });

  it('still classifies a genuinely versionless payload as the OUTAGE class (retention preserved)', async () => {
    // The positive control for the fix: narrowing the shape gate must not break
    // the case retention exists for. A payload with NO readable version at all
    // is still an outage and must still retain.
    const spy = vi
      .spyOn(ISLClient.prototype, 'fetchHealth')
      .mockResolvedValue(health(v5Admission()));
    configureIsl(true);
    await __refreshForTest();

    spy.mockResolvedValue(health({ max_cost_units: 24_000_000, weights: {}, caps: {} }));
    const outage = await __refreshForTest();

    expect(outage.advertisedVersion).toBeUndefined();
    expect(outage.skew).toBe(true);
    expect(outage.retainedAdmissionVersion).toBe(V5_VERSION);
    expect(outage.admission).not.toBeNull();
  });

  it('an unreachable /health is still the OUTAGE class', async () => {
    const spy = vi
      .spyOn(ISLClient.prototype, 'fetchHealth')
      .mockResolvedValue(health(v5Admission()));
    configureIsl(true);
    await __refreshForTest();

    spy.mockResolvedValue(null);
    const down = await __refreshForTest();
    expect(down.status).toBe('unreachable');
    expect(down.retainedAdmissionVersion).toBe(V5_VERSION);
  });
});

// ===========================================================================
// B. Residual 2 — the blind scalar fallback, killed with its own arithmetic.
// ===========================================================================

/**
 * The probe graph: SMALL node×edge product, heavy option/uncertainty depth.
 * Scalar arithmetic (S×N×E) is blind to both of the dimensions that actually
 * drive v5's price, so it reads this graph as trivial.
 */
function scalarBlindGraph(nSamples: number): WeightedCostRequest {
  return {
    nSamples,
    nodeCount: 20,
    edgeCount: 40,
    optionCount: 10,
    uniqueParamUncertainties: 19,
    includeVoi: true,
    includeSensitivity: true,
    includeEValues: true,
    includePathDecomposition: false,
    includeFactorFlips: true,
    controlGridPoints: 0,
  };
}

describe('2.356 — the conservative scalar fallback is arithmetically blind', () => {
  it('the capped fallback depth prices INSIDE every scalar budget and OUTSIDE the real ceiling', () => {
    const scalar = LEGACY_BASE_N_SAMPLES * 20 * 40;
    expect(scalar).toBe(3_200_000);
    // Comfortably inside both scalar budgets — the fallback would forward it.
    expect(scalar).toBeLessThanOrEqual(LEGACY_FALLBACK_SCALAR_BUDGET);
    expect(scalar).toBeLessThanOrEqual(ISL_COMPLEXITY_BUDGET_DEFAULT);

    // ...while ISL's real v5 gate prices the SAME planned request 9.2x higher,
    // above the live 24M ceiling. The fallback's own posture ("cap the depth to
    // 4,000 and check a scalar budget") produces a request ISL refuses.
    const exact = estimateWeightedCostV5(
      scalarBlindGraph(LEGACY_BASE_N_SAMPLES),
      LIVE_V5_WEIGHTS,
      LIVE_V5_FORMULA_PARAMETERS,
    );
    expect(exact).toBe(29_392_600);
    expect(exact).toBeGreaterThan(24_000_000);
    expect(exact / scalar).toBeGreaterThan(9);
  });

  it('resolveAdmissionForPlanning refuses (typed) rather than planning blind when ISL is configured but unreadable', async () => {
    configureIsl(true);
    const spy = vi.spyOn(ISLClient.prototype, 'fetchHealth').mockResolvedValue(null);

    const outcome = await resolveAdmissionForPlanning();

    // ONE bounded synchronous refresh was attempted before giving up — a cold
    // cache must not be answered with a refusal that a single read would have
    // avoided.
    expect(spy).toHaveBeenCalled();
    expect(outcome.kind).toBe('refuse');
    if (outcome.kind === 'refuse') {
      // Truthful code: this is an ENGINE-availability failure, not a property of
      // the caller's graph. It must never be reported as GRAPH_TOO_COMPLEX.
      expect(outcome.code).toBe('ANALYSIS_ENGINE_ADMISSION_UNAVAILABLE');
      expect(outcome.httpStatus).toBe(503);
      expect(outcome.resolution.status).toBe('unreachable');
    }
  });

  it('plans normally when the advertisement is readable', async () => {
    configureIsl(true);
    vi.spyOn(ISLClient.prototype, 'fetchHealth').mockResolvedValue(health(v5Admission()));

    const outcome = await resolveAdmissionForPlanning();
    expect(outcome.kind).toBe('plan');
    if (outcome.kind === 'plan') {
      expect(outcome.resolution.admission).not.toBeNull();
      expect(outcome.conservative).toBe(false);
    }
  });

  it('plans (never refuses) when ISL is not configured — there is no gate to violate', async () => {
    configureIsl(false);

    const outcome = await resolveAdmissionForPlanning();
    expect(outcome.kind).toBe('plan');
    if (outcome.kind === 'plan') {
      expect(outcome.resolution.status).toBe('disabled');
      expect(outcome.conservative).toBe(false);
    }
  });

  it('a RETAINED outage admission still plans — retention is what keeps an outage benign', async () => {
    configureIsl(true);
    const spy = vi
      .spyOn(ISLClient.prototype, 'fetchHealth')
      .mockResolvedValue(health(v5Admission()));
    await __refreshForTest();

    // Drive the outage refresh explicitly, so the CACHE holds the retained
    // resolution. Without this the cache is still the fresh 'ok' read and the
    // test would pass while never exercising retention at all.
    spy.mockResolvedValue(null);
    await __refreshForTest();
    const outcome = await resolveAdmissionForPlanning();

    expect(outcome.kind).toBe('plan');
    if (outcome.kind === 'plan') {
      expect(outcome.resolution.retainedAdmissionVersion).toBe(V5_VERSION);
      expect(outcome.resolution.admission).not.toBeNull();
    }
  });
});

// ===========================================================================
// C. The v6 estimator's own arithmetic.
//
// ⚠ THIS SECTION EXISTS BECAUSE A MUTANT SURVIVED. Deleting the `status_quo`
// term from `estimateWeightedCostV6` left the entire suite GREEN: sections A
// and B exercise the resolver, and the pre-existing handshake suite pins v2 and
// v5, so nothing anywhere asserted what v6 actually computes. The two new terms
// were derived from ISL's source and declared in COMPLEXITY_FORMULA_SPECS —
// which proves the declaration AGREES with itself, and never that the
// arithmetic is right (trap 12d). A corpus of worked numbers is what notices.
//
// Each term is pinned on BOTH sides of its gate: a term covered only in its
// present state leaves the branch that omits it untested, which is how two
// min() branches survived a 2,494-test gate in ISL #119.
// ===========================================================================

const LIVE_V6_WEIGHTS = {
  ...LIVE_V5_WEIGHTS,
  status_quo_coef: 1,
  alt_winner_coef: 1,
} as unknown as ISLComputeAdmissionWeights;

const LIVE_V6_FORMULA_PARAMETERS: ISLComputeAdmissionFormulaParameters = {
  ...LIVE_V5_FORMULA_PARAMETERS,
  alternative_winners: { max_edges: 10, marginal_k_samples: 100 },
};

function v6Request(over: Partial<WeightedCostRequest> = {}): WeightedCostRequest {
  return { ...scalarBlindGraph(10_000), ...over };
}

const v6 = (req: WeightedCostRequest) =>
  estimateWeightedCostV6(req, LIVE_V6_WEIGHTS, LIVE_V6_FORMULA_PARAMETERS);
const v5 = (req: WeightedCostRequest) =>
  estimateWeightedCostV5(req, LIVE_V5_WEIGHTS, LIVE_V5_FORMULA_PARAMETERS);

describe('2.356 — estimateWeightedCostV6 arithmetic', () => {
  it('adds status_quo = S·W for a level-framed goal, with NO option factor', () => {
    const withLevel = v6Request({ levelFramedGoalThreshold: true, includeSensitivity: false });
    const without = v6Request({ levelFramedGoalThreshold: false, includeSensitivity: false });

    // S=10,000, W = 20 + 40 = 60 → 600,000. Emphatically NOT ×O: the reference
    // draw is shared across every option by construction (common random
    // numbers), so multiplying by O would over-charge by a factor of 10 here.
    expect(v6(withLevel) - v6(without)).toBe(600_000);
    expect(v6(withLevel) - v6(without)).not.toBe(600_000 * 10);
  });

  it('adds alternative_winners = O·(1 + min(E, max_edges)·k)·W, gated on SENSITIVITY', () => {
    const withSens = v6Request({ includeSensitivity: true, levelFramedGoalThreshold: false });
    const noSens = v6Request({ includeSensitivity: false, levelFramedGoalThreshold: false });

    // O=10, min(E=40, max_edges=10)=10, k=100, W=60
    //   → 10 · (1 + 10·100) · 60 = 600,600
    const sensitivityTermV5 = v5(withSens) - v5(noSens);
    expect(v6(withSens) - v6(noSens) - sensitivityTermV5).toBe(600_600);
  });

  it('prices the alternative_winners edge count at the CAP, not at E', () => {
    // E=40 and E=200 must charge the SAME alternative-winner term: the cap binds
    // in both. If the estimator used E directly, these would differ 5-fold.
    const small = v6Request({ edgeCount: 40, includeSensitivity: true });
    const large = v6Request({ edgeCount: 200, includeSensitivity: true });
    const altTerm = (r: WeightedCostRequest) =>
      r.optionCount * (1 + Math.min(r.edgeCount, 10) * 100) * (r.nodeCount + r.edgeCount);
    expect(altTerm(small) / (small.nodeCount + small.edgeCount)).toBe(
      altTerm(large) / (large.nodeCount + large.edgeCount),
    );
    // ...and the E-BELOW-CAP branch really binds on E (the other side of min()).
    const tiny = v6Request({ edgeCount: 4, nodeCount: 6, includeSensitivity: true });
    const tinyNoSens = { ...tiny, includeSensitivity: false };
    const tinySensV5 = v5(tiny) - v5(tinyNoSens);
    // O=10, min(4,10)=4, k=100, W=10 → 10·401·10 = 40,100
    expect(v6(tiny) - v6(tinyNoSens) - tinySensV5).toBe(40_100);
  });

  it('is exactly v5 when neither v6 gate fires — v6 never re-prices v5 terms', () => {
    const req = v6Request({ levelFramedGoalThreshold: false, includeSensitivity: false });
    expect(v6(req)).toBe(v5(req));
  });

  it('the v6 spec is registered and prices via estimateWeightedCostV6', () => {
    const spec = COMPLEXITY_FORMULA_SPECS.get('v6-status-quo-alt-winners-2026-08-03');
    expect(spec).toBeDefined();
    expect(KNOWN_COMPLEXITY_FORMULA_VERSIONS.has('v6-status-quo-alt-winners-2026-08-03')).toBe(true);
    // v5 stays registered — that is what makes "deploy PLoT first" safe.
    expect(KNOWN_COMPLEXITY_FORMULA_VERSIONS.has(V5_VERSION)).toBe(true);
    const req = v6Request({ levelFramedGoalThreshold: true });
    expect(spec!.estimate(req, LIVE_V6_WEIGHTS, LIVE_V6_FORMULA_PARAMETERS)).toBe(v6(req));
  });

  it('throws rather than guessing when a v6 number is absent from the advertisement', () => {
    // The fail-closed pin: a missing coefficient must never silently become NaN
    // and collapse the plan to the sample floor.
    const missingCoef = { ...LIVE_V5_WEIGHTS } as unknown as ISLComputeAdmissionWeights;
    expect(() =>
      estimateWeightedCostV6(
        v6Request({ levelFramedGoalThreshold: true }),
        missingCoef,
        LIVE_V6_FORMULA_PARAMETERS,
      ),
    ).toThrow(/status_quo_coef/);
    expect(() =>
      estimateWeightedCostV6(
        v6Request({ includeSensitivity: true }),
        LIVE_V6_WEIGHTS,
        LIVE_V5_FORMULA_PARAMETERS,
      ),
    ).toThrow(/alternative_winners/);
  });
});
