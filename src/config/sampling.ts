/**
 * Track S — Standard Monte Carlo sample depth (base analysis).
 *
 * PR-E raises the standard base-analysis depth from 1,000 to 4,000. Seed-sweep
 * evidence (live ISL, 12 seeds × 4 fixtures) showed 1,000 is unstable/fragile on
 * harder fixtures while 4,000 is the first depth where all fixtures meet the
 * provisional ±3pp displayed-probability stability target; 8,000 gives only
 * diminishing returns. The seed-sweep evidence is summarised in the PR
 * description and reproducible via tools/seed-sweep.mjs.
 *
 * Rollback: set the `STANDARD_N_SAMPLES` env var (e.g. `1000`) to override the
 * default without a code change. This is the emergency knob if latency or
 * operational issues appear after the raise.
 *
 * Flip-threshold probes intentionally do NOT inherit this depth — they have an
 * independent control (see resolveFlipProbeNSamples / FLIP_PROBE_N_SAMPLES in
 * src/analysis/flip-thresholds.ts). Raising the base must not slow flip probes.
 */

import { resolveBoundedIntEnvOrWarn, MIN_N_SAMPLES, MAX_N_SAMPLES } from './env-int.js';

/**
 * Compile-time standard base-analysis sample depth. Fixed (not env-derived) so
 * it can anchor deterministic, environment-independent fallbacks (e.g. the
 * canonical-hash default). The live request path uses resolveStandardNSamples().
 *
 * Paul-ruled lenient defaults 2026-07-17: raised 4000 → 10000 (the schema
 * ceiling). A3 budget-scout measurement (acceptance-evidence/
 * a3-verify-2026-07-16/budget-review.md, task 2a): depth is near-linear at
 * ~22 ms per +1000 samples local (~110 ms staging), so 4000 → 10000 costs
 * ~+0.7 s staging on the base call — trivially inside the UI's 120 s client
 * timeout — while displayed probabilities gain ~sqrt(2.5) stability. The
 * `STANDARD_N_SAMPLES` env var remains the emergency rollback knob.
 * NOTE: the canonical request hash is sample-aware by design, so requests
 * that omit n_samples hash differently after this raise — post-deploy
 * freshness correctly sees a NEW analysis config (results at 10k are not
 * results at 4k), invalidating stale-at-4k caches rather than forking
 * identity.
 */
export const STANDARD_N_SAMPLES_DEFAULT = 10_000;

/**
 * Resolve the standard base-analysis sample depth for a request whose
 * `n_samples` was omitted.
 *
 * Precedence:
 *  1. `STANDARD_N_SAMPLES` env — strictly parsed, in-bounds (100..10000)
 *     emergency rollback / override; malformed (`1,000`, `1000abc`) or
 *     out-of-bounds values are ignored (with a one-time warning) so they cannot
 *     bypass the /v2/run schema bound or forward a garbage depth to ISL;
 *  2. otherwise `STANDARD_N_SAMPLES_DEFAULT` (4,000).
 *
 * Read at call time so the override takes effect without a rebuild and is
 * trivially testable. An explicit `n_samples` in the request always wins over
 * this default (the route applies `body.n_samples ?? resolveStandardNSamples()`).
 */
export function resolveStandardNSamples(): number {
  return resolveBoundedIntEnvOrWarn('STANDARD_N_SAMPLES', MIN_N_SAMPLES, MAX_N_SAMPLES) ?? STANDARD_N_SAMPLES_DEFAULT;
}

// ---------------------------------------------------------------------------
// ROADMAP 1.54 — Adaptive depth vs the ISL complexity cap (density wall)
// ---------------------------------------------------------------------------

/**
 * LEGACY SCALAR budget — the pre-F8 admission shape `n_samples × nodes × edges`.
 *
 * ⚠ NO LONGER THE PRIMARY GATE. Since ISL F8 (#80) the LIVE admission gate is a
 * WEIGHTED cost model advertised on ISL `/health` (`compute_admission`), and
 * PLoT now DERIVES its sample-reduction planning from that live block (see
 * planSampleDepth / estimateWeightedCostV2 below and
 * src/integrations/isl/compute-admission.ts). This scalar budget survives ONLY
 * as the CONSERVATIVE FALLBACK used when the /health handshake is unavailable
 * (unreachable, no `compute_admission` block, or an unknown formula version) —
 * see LEGACY_FALLBACK_SCALAR_BUDGET.
 *
 * The 30M value is retained here (not the 10M fallback) purely as the historical
 * `resolveComplexityBudget()` default so the existing env-override semantics and
 * unit tests stay intact; the fail-loud fallback path CLAMPS this down to the
 * conservative LEGACY_FALLBACK_SCALAR_BUDGET (10M) via Math.min.
 *
 * ✅ DEPLOY-ORDER LOCK-STEP RELAXED (F8 handshake): PLoT no longer needs ISL and
 * PLoT to be pinned to the same `ISL_MAX_COMPUTE_COMPLEXITY` value. PLoT reads
 * ISL's LIVE ceiling from `/health`; if that read fails PLoT fails LOUD and
 * falls back conservatively (10M scalar, base depth capped at 4,000) rather than
 * silently trusting a hand-mirrored number. The env below remains usable only as
 * an OPTIONAL PLoT-side LOWER clamp on the legacy scalar fallback path.
 */
export const ISL_COMPLEXITY_BUDGET_DEFAULT = 30_000_000;

/**
 * Conservative scalar budget for the fail-loud FALLBACK path (unknown/unreachable
 * ISL capability). This is ISL's historical pre-F8 scalar default (10M) — the
 * value that is safe against BOTH a pre-F8 ISL (which enforced exactly this
 * scalar gate) AND a live weighted-F8 ISL (the scalar `n×N×E` over-prices
 * relative to the weighted `n×O×(N+E)+…` shape, so it never under-reduces below
 * what the weighted gate would accept). Never widen this on the fallback path —
 * the whole point of failing loud is to plan conservatively when we cannot
 * confirm ISL's real gate.
 */
export const LEGACY_FALLBACK_SCALAR_BUDGET = 10_000_000;

/**
 * Base sample depth used when the depth-raise is DISABLED (the fail-loud
 * fallback). The STANDARD_N_SAMPLES_DEFAULT raise to 10,000 was Paul-ruled on
 * the assumption ISL could admit it; without a confirmed live ceiling PLoT
 * reverts a DEFAULTED depth to the conservative pre-raise 4,000. An EXPLICIT
 * caller depth is never raised or silently capped by this — only the reduction
 * floor/refusal applies to it.
 */
export const LEGACY_BASE_N_SAMPLES = 4_000;

/**
 * The floor for ADAPTIVE reductions: PLoT never lowers a requested depth
 * below 1,000 samples — below that, displayed probabilities are too unstable
 * to present honestly (Track S seed-sweep evidence: 1,000 is already
 * fragile on harder fixtures). A graph that cannot fit the budget even at
 * this floor (nodes × edges > budget / 1,000) is refused with a structured
 * GRAPH_TOO_COMPLEX blocker instead of silently degrading further.
 * NOTE: this floor bounds reductions only — an EXPLICIT caller depth below
 * 1,000 that already fits the budget is respected untouched.
 */
export const ADAPTIVE_N_SAMPLES_FLOOR = 1_000;

/**
 * Resolve the legacy SCALAR complexity budget (fallback path only).
 *
 * Env `ISL_MAX_COMPUTE_COMPLEXITY` remains an OPTIONAL PLoT-side LOWER clamp on
 * the scalar fallback path (its natural scalar units). The cross-service
 * lock-step it once enforced is no longer required — PLoT reads ISL's live
 * ceiling from `/health` on the primary path. Strictly parsed (see env-int.ts);
 * malformed or out-of-bounds values fall back to the default. Read at call time
 * so an override takes effect without a rebuild.
 */
export function resolveComplexityBudget(): number {
  return (
    resolveBoundedIntEnvOrWarn('ISL_MAX_COMPUTE_COMPLEXITY', 1_000, 1_000_000_000_000) ??
    ISL_COMPLEXITY_BUDGET_DEFAULT
  );
}

/** Outcome of applying the complexity budget to a resolved sample depth. */
export type ComplexityBudgetDecision =
  | {
      /** Depth fits the budget as-is (or there is nothing to bound). */
      kind: 'unchanged';
      nSamples: number;
      complexity: number;
      budget: number;
    }
  | {
      /** Depth was lowered to the largest value that fits the budget (≥ floor). */
      kind: 'reduced';
      nSamples: number;
      originalNSamples: number;
      /** complexity at the ORIGINAL depth (what would have been sent). */
      complexity: number;
      /** complexity at the REDUCED depth (what will be sent). */
      reducedComplexity: number;
      budget: number;
    }
  | {
      /** Even ADAPTIVE_N_SAMPLES_FLOOR samples exceed the budget — refuse before ISL. */
      kind: 'refused';
      originalNSamples: number;
      /** The largest depth that would fit (strictly below the floor here). */
      fittingNSamples: number;
      nodeEdgeProduct: number;
      /** Largest nodes × edges product analysable at the floor depth. */
      maxNodeEdgeProduct: number;
      budget: number;
    };

/**
 * Apply ISL's complexity budget to the resolved sample depth BEFORE the ISL
 * call, using the node/edge counts of the request ISL will actually receive
 * (causal graph: option/decision nodes filtered, bidirected edges dropped).
 *
 *  - complexity = nSamples × nodeCount × edgeCount; ≤ budget passes (ISL
 *    blocks strictly above the limit);
 *  - over budget → reduce to floor(budget / (nodes × edges)), never below
 *    {@link ADAPTIVE_N_SAMPLES_FLOOR};
 *  - if even the floor exceeds the budget → 'refused' (caller emits a
 *    GRAPH_TOO_COMPLEX blocker instead of forwarding a doomed request).
 *
 * Applies identically to defaulted and explicit caller depths — an explicit
 * depth is never silently overridden: the caller pairs every reduction with
 * a SAMPLES_REDUCED_FOR_COMPLEXITY warning naming both depths.
 */
export function applyComplexityBudget(
  nSamples: number,
  nodeCount: number,
  edgeCount: number,
  budgetOverride?: number,
): ComplexityBudgetDecision {
  const budget = budgetOverride ?? resolveComplexityBudget();
  const product = nodeCount * edgeCount;
  const complexity = nSamples * product;

  // Nothing to bound (degenerate graph) or already within budget.
  if (product <= 0 || complexity <= budget) {
    return { kind: 'unchanged', nSamples, complexity, budget };
  }

  const fittingNSamples = Math.floor(budget / product);
  if (fittingNSamples < ADAPTIVE_N_SAMPLES_FLOOR) {
    return {
      kind: 'refused',
      originalNSamples: nSamples,
      fittingNSamples,
      nodeEdgeProduct: product,
      maxNodeEdgeProduct: Math.floor(budget / ADAPTIVE_N_SAMPLES_FLOOR),
      budget,
    };
  }

  return {
    kind: 'reduced',
    nSamples: fittingNSamples,
    originalNSamples: nSamples,
    complexity,
    reducedComplexity: fittingNSamples * product,
    budget,
  };
}

// ---------------------------------------------------------------------------
// Codex F8 handshake — WEIGHTED compute-admission planning (Option B)
// ---------------------------------------------------------------------------
//
// ISL F8 replaced the scalar admission gate with a WEIGHTED cost model and
// advertises it LIVE on `/health` (`compute_admission`). PLoT now DERIVES its
// sample-reduction planning from that live block instead of hand-mirroring a
// scalar ceiling. Derive-don't-mirror (programme memory-trap #12):
//   - the COEFFICIENTS come from the advertised `weights` object at runtime
//     (never re-hardcoded here — that would be Option A, rejected);
//   - the FORMULA SHAPE is keyed by `complexity_formula_version`; PLoT plans
//     ONLY for versions in KNOWN_COMPLEXITY_FORMULA_VERSIONS and FAILS LOUD
//     (conservative legacy fallback) on anything else, so drift is VISIBLE.

import type {
  ISLComputeAdmission,
  ISLComputeAdmissionWeights,
} from '../integrations/isl/types/isl-types.js';

/**
 * Formula-shape versions PLoT knows how to plan against. The shape implemented
 * by {@link estimateWeightedCostV2} is `v2-weighted-2026-07`. An advertised
 * version NOT in this set is treated as skew → fail-loud conservative fallback.
 * This is a DERIVED guard, not a mirror: it lists only the SHAPES PLoT has code
 * for; the numeric coefficients still come from the live `weights`.
 */
export const KNOWN_COMPLEXITY_FORMULA_VERSIONS: ReadonlySet<string> = new Set([
  'v2-weighted-2026-07',
]);

/**
 * PLoT-side hard upper bound on the planning ceiling, in ISL cost units.
 * effective_ceiling = min(this, live max_cost_units[, optional env lower clamp]).
 *
 * This is the "belt" that bounds PLoT's per-request base-call cost regardless of
 * what `/health` advertises — a garbage or absurdly-high advertised ceiling can
 * never make PLoT plan a base call so heavy it blows PLoT's own ISL timeout
 * (ISL_TIMEOUT_MS, 60 s). Set at 30M cost units: ~25% headroom over ISL's
 * current 24M default (so a modest ISL staging recalibration flows through and
 * `live` wins the min), while a base call at ~30M still returns inside PLoT's
 * 60 s timeout (ISL calibrated its heaviest ~22.5M admitted case at ~24.7 s
 * local). In NORMAL operation the live 24M is below this, so the live ceiling
 * governs — derive-don't-mirror. Env `ISL_MAX_COST_UNITS` may lower it further.
 */
export const PLOT_SAFETY_CEILING_COST_UNITS = 30_000_000;

/**
 * Resolve the effective WEIGHTED planning ceiling (cost units):
 * `min(PLOT_SAFETY_CEILING_COST_UNITS, live max_cost_units, ISL_MAX_COST_UNITS?)`.
 * The env is an OPTIONAL PLoT-side LOWER clamp ONLY (it can never RAISE the
 * ceiling above the live/safety min); it is in cost units (matching ISL's own
 * `ISL_MAX_COST_UNITS`), deliberately NOT the old scalar `ISL_MAX_COMPUTE_COMPLEXITY`
 * whose value would be in the wrong units for this formula.
 */
export function resolveWeightedCostCeiling(liveMaxCostUnits: number): number {
  const envClamp = resolveBoundedIntEnvOrWarn('ISL_MAX_COST_UNITS', 1, Number.MAX_SAFE_INTEGER);
  let ceiling = Math.min(PLOT_SAFETY_CEILING_COST_UNITS, liveMaxCostUnits);
  if (envClamp !== null) ceiling = Math.min(ceiling, envClamp);
  return ceiling;
}

/**
 * The request shape the weighted estimator prices. Mirrors the fields the ISL
 * base /v2/run request carries; the optional-phase booleans mirror the enable
 * conditions in ISL's `compute_weighted_cost`.
 */
export interface WeightedCostRequest {
  /** S — Monte Carlo sample depth. */
  nSamples: number;
  /** N — causal node count ISL will receive. */
  nodeCount: number;
  /** E — causal (directed) edge count ISL will receive. */
  edgeCount: number;
  /** O — option count ISL will receive. */
  optionCount: number;
  /** U — number of UNIQUE parameter uncertainties (factor node_ids). */
  uniqueParamUncertainties: number;
  /** EVPI priced iff include_voi AND U > 0 (PLoT always sends include_voi). */
  includeVoi: boolean;
  /** Edge sensitivity priced iff 'sensitivity' in analysis_types (always for base). */
  includeSensitivity: boolean;
  /** e-values + stability bands priced iff include_e_values (always for base). */
  includeEValues: boolean;
  /** Path decomposition priced iff include_path_decomposition (request-gated). */
  includePathDecomposition: boolean;
}

/**
 * Weighted compute-admission cost, in ISL cost units, for the `v2-weighted-2026-07`
 * formula shape. The COEFFICIENTS are taken from the ADVERTISED `weights`
 * argument — this function hard-codes only the STRUCTURAL shape (which weight
 * multiplies what), exactly mirroring ISL `compute_weighted_cost` at that
 * version. It must never re-hardcode a coefficient value.
 *
 *   cost = base·S·O·W                                        (base MC, always)
 *        + (U+1)·min(S, evpi_sample_cap)·O·W                 (EVPI, if include_voi & U>0)
 *        + sensitivity_coef·E·min(100, ⌊S/10⌋)·W             (edge sensitivity)
 *        + evalue_coef·E·O                                   (e-values)
 *        + bands_coef·E·O                                    (bands, ride on e-values)
 *        + path_coef·min(max_decomposition_paths, E·E)       (path decomposition)
 *   where W = N + E (per-evaluate structural work).
 */
export function estimateWeightedCostV2(
  req: WeightedCostRequest,
  weights: ISLComputeAdmissionWeights,
): number {
  const S = req.nSamples;
  const O = req.optionCount;
  const N = req.nodeCount;
  const E = req.edgeCount;
  const W = N + E;
  const U = req.uniqueParamUncertainties;

  let cost = weights.base_per_sample_per_option_per_struct * S * O * W;

  if (req.includeVoi && U > 0) {
    cost += (U + 1) * Math.min(S, weights.evpi_sample_cap) * O * W;
  }
  if (req.includeSensitivity) {
    cost += weights.sensitivity_coef * E * Math.min(100, Math.floor(S / 10)) * W;
  }
  if (req.includeEValues) {
    cost += weights.evalue_coef * E * O;
    cost += weights.bands_coef * E * O;
  }
  if (req.includePathDecomposition) {
    cost += weights.path_coef * Math.min(weights.max_decomposition_paths, E * E);
  }
  return cost;
}

/** Which planning mode produced a {@link DepthPlanDecision}. */
export type DepthPlanMode = 'weighted' | 'legacy_fallback';

/** Input to {@link planSampleDepth} — the full request shape plus caller intent. */
export interface DepthPlanInput extends WeightedCostRequest {
  /** True when the caller supplied n_samples explicitly (never depth-capped). */
  nSamplesExplicit: boolean;
}

/**
 * Outcome of planning the base-call sample depth against the (live or fallback)
 * admission gate. Structurally parallel to {@link ComplexityBudgetDecision} so
 * the /v2/run route handles refused/reduced/unchanged the same way, but the
 * numbers are expressed as generic cost/ceiling so a caller need not know which
 * mode produced them.
 */
export type DepthPlanDecision =
  | { kind: 'unchanged'; nSamples: number; cost: number; ceiling: number; mode: DepthPlanMode }
  | {
      kind: 'reduced';
      nSamples: number;
      originalNSamples: number;
      /** cost at the ORIGINAL depth. */
      cost: number;
      /** cost at the REDUCED depth. */
      reducedCost: number;
      ceiling: number;
      mode: DepthPlanMode;
    }
  | {
      kind: 'refused';
      originalNSamples: number;
      /** cost at the minimum reliable depth ({@link ADAPTIVE_N_SAMPLES_FLOOR}). */
      costAtFloor: number;
      ceiling: number;
      nodeCount: number;
      edgeCount: number;
      mode: DepthPlanMode;
    };

/** Options controlling the fallback posture when there is no usable admission. */
export interface PlanSampleDepthOptions {
  /**
   * True for a GENUINE skew (ISL configured but its capability is unreadable or
   * its formula version unknown) — the fail-loud posture: DISABLE the
   * depth-raise (cap a defaulted depth to {@link LEGACY_BASE_N_SAMPLES}) and use
   * the conservative {@link LEGACY_FALLBACK_SCALAR_BUDGET}. False (default:
   * true when omitted) for a benign no-gate state (ISL not configured, or the
   * cold warm-up before the first /health read) — keep the standard depth and
   * the historical scalar budget, exactly as before the handshake existed.
   */
  conservative?: boolean;
}

/**
 * Plan the base-call sample depth.
 *
 * @param input   the request shape (counts + phase flags + explicit-depth intent)
 * @param admission the LIVE, version-VALIDATED ISL compute-admission block, or
 *   `null` when the /health handshake was unavailable or skewed. A non-null
 *   admission MUST already be version-checked by the caller
 *   (compute-admission.ts); this function re-guards defensively.
 * @param opts.conservative see {@link PlanSampleDepthOptions.conservative}.
 *
 * WEIGHTED path (admission present, known version): reduce to the largest depth
 * whose weighted cost fits `min(safety, live)`; refuse if even the floor does
 * not fit. LEGACY FALLBACK path (admission null): plan against the scalar
 * budget; when `conservative` (genuine skew) also disable the depth-raise.
 */
export function planSampleDepth(
  input: DepthPlanInput,
  admission: ISLComputeAdmission | null,
  opts: PlanSampleDepthOptions = {},
): DepthPlanDecision {
  if (admission && KNOWN_COMPLEXITY_FORMULA_VERSIONS.has(admission.complexity_formula_version)) {
    return planWeighted(input, admission);
  }
  return planLegacyFallback(input, opts.conservative ?? true);
}

/** Weighted planning against the live advertised ceiling + weights. */
function planWeighted(input: DepthPlanInput, admission: ISLComputeAdmission): DepthPlanDecision {
  const ceiling = resolveWeightedCostCeiling(admission.max_cost_units);
  const weights = admission.weights;
  const requested = input.nSamples;

  const costAt = (s: number): number =>
    estimateWeightedCostV2({ ...input, nSamples: s }, weights);

  const requestedCost = costAt(requested);
  if (requestedCost <= ceiling) {
    return { kind: 'unchanged', nSamples: requested, cost: requestedCost, ceiling, mode: 'weighted' };
  }

  // Even the minimum reliable depth is too costly → refuse before ISL.
  const floorCost = costAt(ADAPTIVE_N_SAMPLES_FLOOR);
  if (floorCost > ceiling) {
    return {
      kind: 'refused',
      originalNSamples: requested,
      costAtFloor: floorCost,
      ceiling,
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      mode: 'weighted',
    };
  }

  // Largest depth in [floor, requested] whose weighted cost fits. Cost is
  // monotonic non-decreasing in S, so binary-search the boundary — this stays
  // correct for any (monotonic) advertised weights without inverting the formula.
  let lo = ADAPTIVE_N_SAMPLES_FLOOR;
  let hi = requested;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2); // bias high; lo<hi so mid>lo
    if (costAt(mid) <= ceiling) lo = mid;
    else hi = mid - 1;
  }
  const reduced = lo;
  return {
    kind: 'reduced',
    nSamples: reduced,
    originalNSamples: requested,
    cost: requestedCost,
    reducedCost: costAt(reduced),
    ceiling,
    mode: 'weighted',
  };
}

/**
 * Legacy scalar fallback (no usable weighted admission). Maps
 * {@link applyComplexityBudget} into the generic decision shape.
 *
 * `conservative` (genuine skew): scalar gate at
 * `min(LEGACY_FALLBACK_SCALAR_BUDGET, env clamp)` AND a DEFAULTED depth capped to
 * {@link LEGACY_BASE_N_SAMPLES} (depth-raise disabled) — the fail-loud posture.
 * Otherwise (ISL absent / cold warm-up, no gate to skew against): the historical
 * scalar budget (`resolveComplexityBudget()`, 30M default) at the standard depth
 * — byte-for-byte the pre-handshake behaviour.
 */
function planLegacyFallback(input: DepthPlanInput, conservative: boolean): DepthPlanDecision {
  // Disable the depth-raise for a DEFAULTED depth ONLY under a genuine skew;
  // explicit caller depths pass through to the budget check untouched (never
  // silently raised or lowered except by the reduction/refusal below).
  const planned = conservative && !input.nSamplesExplicit
    ? Math.min(input.nSamples, LEGACY_BASE_N_SAMPLES)
    : input.nSamples;

  const budget = conservative
    ? Math.min(LEGACY_FALLBACK_SCALAR_BUDGET, resolveComplexityBudget())
    : resolveComplexityBudget();
  const scalar = applyComplexityBudget(planned, input.nodeCount, input.edgeCount, budget);

  if (scalar.kind === 'refused') {
    return {
      kind: 'refused',
      originalNSamples: scalar.originalNSamples,
      costAtFloor: ADAPTIVE_N_SAMPLES_FLOOR * scalar.nodeEdgeProduct,
      ceiling: budget,
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      mode: 'legacy_fallback',
    };
  }
  if (scalar.kind === 'reduced') {
    return {
      kind: 'reduced',
      nSamples: scalar.nSamples,
      originalNSamples: scalar.originalNSamples,
      cost: scalar.complexity,
      reducedCost: scalar.reducedComplexity,
      ceiling: budget,
      mode: 'legacy_fallback',
    };
  }
  return { kind: 'unchanged', nSamples: scalar.nSamples, cost: scalar.complexity, ceiling: budget, mode: 'legacy_fallback' };
}
