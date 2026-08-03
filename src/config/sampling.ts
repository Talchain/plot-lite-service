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
 *  2. otherwise `STANDARD_N_SAMPLES_DEFAULT` (10,000).
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
 * ISL capability). This is ISL's historical pre-F8 scalar default (10M) — safe
 * against a pre-F8 ISL, which enforced exactly this scalar gate.
 *
 * ⚠ ROADMAP 2.289 — THE CLAIM THAT USED TO SIT HERE WAS FALSE. This comment
 * asserted the scalar `n×N×E` "over-prices relative to the weighted shape, so
 * it never under-reduces below what the weighted gate would accept". For v5
 * that is arithmetically wrong: the scalar carries no option factor and none of
 * v5's EVPI/EVPPI/flip terms, so an option- or uncertainty-heavy graph prices
 * FAR below its true cost. Worked example (pinned in
 * tests/isl-admission-unknown-honest-fallback.test.ts): N=20, E=40, O=10, U=19
 * at S=10,000 → scalar 8.0M (inside BOTH the 10M fallback and 30M historical
 * budgets) while the exact v5 cost is 34,930,600 against ISL's live 24M
 * ceiling — the request passes every scalar gate and ISL refuses it with a raw
 * 422. Even the capped fallback depth (4,000) still prices at 29.4M on that
 * graph: NO scalar arithmetic can promise admission against a weighted gate it
 * cannot see.
 *
 * The fallback is therefore a DAMAGE LIMITER, not a guarantee, and the real
 * protections sit upstream (all ROADMAP 2.289): the admission cache is warmed
 * before the server accepts traffic (main.ts → warmIslComputeAdmission), an
 * OUTAGE-class skew (unreadable /health — no advertised version) retains the
 * last-known-good advertisement so weighted pricing survives /health outages
 * (drift-class skews never retain, by the #305 review ruling), and any
 * residual admission-unknown plan is conservative AND disclosed on the wire
 * (`admission_unavailable`). Never widen this value on the fallback path —
 * planning tighter when we cannot confirm ISL's real gate is the one lever
 * this path still has.
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
  ISLComputeAdmissionFormulaParameters,
} from '../integrations/isl/types/isl-types.js';

/**
 * The weight coefficients {@link estimateWeightedCostV2} consumes — i.e. the
 * COMPLETE set of `weights` keys the `v2-weighted-2026-07` formula shape prices.
 *
 * ⚠ This list is load-bearing in BOTH directions and must stay exactly in step
 * with the function body below:
 *  - every key here must be READ by estimateWeightedCostV2 (else PLoT demands a
 *    coefficient it does not use);
 *  - every key estimateWeightedCostV2 reads must appear here — an UNDECLARED
 *    read is never validated as finite, so it resolves to `undefined` and
 *    yields a NaN cost while the block still classifies `ok`.
 *
 * `tests/isl-compute-admission-handshake.test.ts` pins the two directions with
 * two DIFFERENT mechanisms, because one cannot see the other: DIRECTION 1
 * perturbs each declared key and asserts the cost moves (declared ⇒ read);
 * DIRECTION 2 prices a request through a recording Proxy and asserts no read
 * fell outside this set (read ⇒ declared). A value-based assertion cannot
 * detect an undeclared read, so the Proxy is not decoration.
 */
export const V2_WEIGHTED_2026_07_WEIGHT_KEYS = [
  'base_per_sample_per_option_per_struct',
  'evpi_sample_cap',
  'sensitivity_coef',
  'evalue_coef',
  'bands_coef',
  'path_coef',
  'max_decomposition_paths',
] as const;

/**
 * The `weights` keys {@link estimateWeightedCostV5} consumes — the COMPLETE set
 * the `v5-factor-flips-2026-08-01` shape prices. Derived from ISL
 * `robustness_analyzer_v2.py` `compute_weighted_cost` at PR #119 head
 * `aba52131`; the same both-directions contract as the v2 list above applies,
 * and is pinned by the same two independent mechanisms.
 *
 * The five keys beyond v2 are the four cost terms v2 never priced
 * (`evppi_full`, `evpc`, `structural_influence`, `factor_flips`) — the 43%
 * under-count measured in `measure-2260-skew-fallback.md` §6.2.
 */
export const V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS = [
  'base_per_sample_per_option_per_struct',
  'evpi_sample_cap',
  'evpc_coef',
  'evppi_full_coef',
  'evppi_null_permutations',
  'factor_flip_coef',
  'influence_walk_pool',
  'sensitivity_coef',
  'evalue_coef',
  'bands_coef',
  'path_coef',
  'max_decomposition_paths',
] as const;

/**
 * The `caps` keys each formula shape's STRUCTURAL gate pre-checks
 * ({@link checkAdmissionCaps}).
 *
 * ⚠ ROADMAP 2.260 — THIS WAS THE SECOND HAND-MAINTAINED MIRROR (trap 12), and
 * it was flagged as bycatch by PR #302 rather than fixed. `CAP_KEYS` in
 * compute-admission.ts was a FIXED four-element list while ISL's v5 block
 * advertises SIX. The two extra caps (`max_control_candidates`,
 * `max_control_values`) were therefore validated by nothing and enforced by
 * nothing: a request breaching them was forwarded to ISL and came back as a raw
 * Pydantic 422 instead of PLoT's structured `GRAPH_TOO_COMPLEX` blocker.
 * Now version-derived and exact-set-coupled, exactly like the weight keys.
 */
export const V2_WEIGHTED_2026_07_CAP_KEYS = [
  'max_options',
  'max_nodes',
  'max_edges',
  'max_parameter_uncertainties',
] as const;

/** The six caps ISL's v5 block advertises (live /health, verified 2026-08-01). */
export const V5_FACTOR_FLIPS_2026_08_01_CAP_KEYS = [
  'max_options',
  'max_nodes',
  'max_edges',
  'max_parameter_uncertainties',
  'max_control_candidates',
  'max_control_values',
] as const;

/**
 * Per-TERM structural parameters a formula shape reads from the advertised
 * `compute_admission.formula_parameters`, keyed by ISL's own term name.
 *
 * These are the numbers a term's loop bounds ITSELF by — as opposed to the
 * per-phase coefficients in `weights`. PLoT hard-codes only the term's SHAPE;
 * every number comes from the live advertisement.
 */
export const SENSITIVITY_FORMULA_PARAMETERS = ['subsample_cap', 'subsample_divisor'] as const;
export const FACTOR_FLIPS_FORMULA_PARAMETERS = ['max_candidates', 'stability_seeds'] as const;
/** v6 (ROADMAP 2.356): the marginal-switch sweep's own loop bounds. */
export const ALTERNATIVE_WINNERS_FORMULA_PARAMETERS = [
  'max_edges',
  'marginal_k_samples',
] as const;

/**
 * v6 — ISL PR (ROADMAP 2.356) adds TWO weight keys to the v5 set.
 *
 * `status_quo_coef` prices the per-draw status-quo reference ISL has run since
 * ROADMAP 2.286 for a LEVEL-framed goal threshold, and `alt_winner_coef` prices
 * the marginal-switch sweep inside `_compute_alternative_winners`. Both phases
 * were doing real SCM evaluations that no v5 term charged for, so a request
 * could clear ISL's ceiling and then do up to ~1.7x the admitted work (measured
 * by ISL's evaluator-call-count oracle on its boundary shapes).
 *
 * ⚠ DEPLOY ORDER IS NOT SYMMETRIC — PLoT FIRST. This build keeps the v5 spec
 * alongside v6, so a v6-aware PLoT prices a v5 ISL exactly as it does today. The
 * reverse does not hold: a v6 ISL in front of a v5-only PLoT advertises two
 * weight keys PLoT does not price, trips `unknown_weight_keys`, and drops EVERY
 * request to the conservative fallback. Ship this, confirm it on staging, then
 * ship ISL.
 */
export const V6_STATUS_QUO_ALT_WINNERS_2026_08_03_WEIGHT_KEYS = [
  ...V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS,
  'status_quo_coef',
  'alt_winner_coef',
] as const;

/** v6 advertises the same six structural caps as v5. */
export const V6_STATUS_QUO_ALT_WINNERS_2026_08_03_CAP_KEYS =
  V5_FACTOR_FLIPS_2026_08_01_CAP_KEYS;

/**
 * The signature every version's cost estimator satisfies. `formulaParameters`
 * is passed SEPARATELY from `weights` (rather than the estimator reaching into
 * the admission block) so the handshake test can wrap EACH object in its own
 * recording Proxy and prove no undeclared number is read from either.
 */
export type WeightedCostEstimator = (
  req: WeightedCostRequest,
  weights: ISLComputeAdmissionWeights,
  formulaParameters: ISLComputeAdmissionFormulaParameters,
) => number;

/** Everything PLoT needs in order to plan against one advertised formula shape. */
export interface ComplexityFormulaSpec {
  /** The EXACT `weights` key set this shape's estimator prices. */
  readonly weightKeys: ReadonlySet<string>;
  /** The EXACT `caps` key set this shape's structural gate pre-checks. */
  readonly capKeys: ReadonlySet<string>;
  /** term name → the EXACT parameter names this shape reads for that term. */
  readonly formulaParameters: ReadonlyMap<string, ReadonlySet<string>>;
  /** The cost model itself. */
  readonly estimate: WeightedCostEstimator;
}

/**
 * Formula-shape version → EVERYTHING that version's planner needs. The SINGLE
 * source of truth for the handshake's version guard (ROADMAP 2.260).
 *
 * Four properties follow mechanically from the map's shape, and all four exist
 * to kill the hand-maintained-mirror defect class (programme trap 12):
 *
 *  1. {@link KNOWN_COMPLEXITY_FORMULA_VERSIONS} is DERIVED from these keys, so a
 *     version can never be admitted without also declaring what it prices —
 *     "just add the version string" is not expressible.
 *  2. The resolver (compute-admission.ts `classify`) compares ISL's ADVERTISED
 *     weight keys against `weightKeys` and treats any UNEXPECTED key as skew
 *     (`unknown_weight_keys`). An unrecognised coefficient is precisely the
 *     signal that ISL's cost formula grew a term PLoT does not price, DERIVED
 *     from the live payload rather than remembered. Without it a same-version
 *     term addition under-prices SILENTLY and converts a safe conservative
 *     fallback into a pass-then-422.
 *  3. `capKeys` gets the identical exact-set treatment, retiring the fixed
 *     four-element `CAP_KEYS` list.
 *  4. `formulaParameters` is the FAIL-CLOSED half. A shape whose estimator needs
 *     a per-term constant declares it here, and the resolver refuses to admit
 *     the version until the live advertisement carries it
 *     (`missing_formula_parameters`). PLoT therefore NEVER substitutes a
 *     hard-coded value for a number ISL has not published — which is what makes
 *     this change safe to deploy in EITHER order relative to ISL PR #119, and
 *     what makes a future ISL parameter REMOVAL degrade loudly instead of
 *     silently mis-pricing.
 *
 * ⚠ CONSEQUENCE WORTH KNOWING BEFORE YOU EDIT (disclosed for reviewers): because
 * `formulaParameters` is exact-set-coupled like `weights`, ISL adding a NEW
 * parameter under this version — even a harmless one — drops PLoT to its
 * conservative fallback until PLoT declares it. ISL PR #119 chose
 * `formula_parameters` as a SIBLING of `weights` specifically to avoid that
 * lockstep, and its docstring states "PLoT cannot detect their addition". After
 * this change PLoT CAN, and does. The divergence is deliberate: every parameter
 * addition under a priced term means PLoT's hard-coded shape for that term is
 * now incomplete, which is a wrong-number hazard, and this programme's standing
 * rule is that a mirror must fail LOUD on drift rather than assume-good. The
 * cost is a loud, safe, one-line-recoverable fallback on a purely cosmetic ISL
 * addition. If that trade is ever judged wrong, relax the UNEXPECTED-parameter
 * check only — never the REQUIRED-parameter check, which is the fail-closed pin.
 */
export const COMPLEXITY_FORMULA_SPECS: ReadonlyMap<string, ComplexityFormulaSpec> = new Map<
  string,
  ComplexityFormulaSpec
>([
  [
    'v2-weighted-2026-07',
    {
      weightKeys: new Set<string>(V2_WEIGHTED_2026_07_WEIGHT_KEYS),
      capKeys: new Set<string>(V2_WEIGHTED_2026_07_CAP_KEYS),
      formulaParameters: new Map<string, ReadonlySet<string>>([
        ['sensitivity', new Set<string>(SENSITIVITY_FORMULA_PARAMETERS)],
      ]),
      estimate: estimateWeightedCostV2,
    },
  ],
  [
    'v5-factor-flips-2026-08-01',
    {
      weightKeys: new Set<string>(V5_FACTOR_FLIPS_2026_08_01_WEIGHT_KEYS),
      capKeys: new Set<string>(V5_FACTOR_FLIPS_2026_08_01_CAP_KEYS),
      formulaParameters: new Map<string, ReadonlySet<string>>([
        ['factor_flips', new Set<string>(FACTOR_FLIPS_FORMULA_PARAMETERS)],
        ['sensitivity', new Set<string>(SENSITIVITY_FORMULA_PARAMETERS)],
      ]),
      estimate: estimateWeightedCostV5,
    },
  ],
  [
    // ROADMAP 2.356. v5 is kept ALONGSIDE v6 on purpose — that is what makes
    // "deploy PLoT first" safe. Removing it would force a lockstep cutover and
    // reintroduce the deploy-order coupling this whole handshake exists to end.
    'v6-status-quo-alt-winners-2026-08-03',
    {
      weightKeys: new Set<string>(V6_STATUS_QUO_ALT_WINNERS_2026_08_03_WEIGHT_KEYS),
      capKeys: new Set<string>(V6_STATUS_QUO_ALT_WINNERS_2026_08_03_CAP_KEYS),
      formulaParameters: new Map<string, ReadonlySet<string>>([
        ['alternative_winners', new Set<string>(ALTERNATIVE_WINNERS_FORMULA_PARAMETERS)],
        ['factor_flips', new Set<string>(FACTOR_FLIPS_FORMULA_PARAMETERS)],
        ['sensitivity', new Set<string>(SENSITIVITY_FORMULA_PARAMETERS)],
      ]),
      estimate: estimateWeightedCostV6,
    },
  ],
]);

/**
 * Version → its exact priced `weights` key set. A DERIVED VIEW of
 * {@link COMPLEXITY_FORMULA_SPECS} (the shape PR #302 introduced), retained
 * because the resolver and its pins read it directly.
 */
export const COMPLEXITY_FORMULA_WEIGHT_KEYS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  [...COMPLEXITY_FORMULA_SPECS].map(([version, spec]) => [version, spec.weightKeys]),
);

/**
 * Formula-shape versions PLoT knows how to plan against — DERIVED from
 * {@link COMPLEXITY_FORMULA_SPECS}, never hand-listed. An advertised version NOT
 * in this set is treated as skew → fail-loud conservative fallback. This lists
 * only the SHAPES PLoT has code for; every numeric coefficient and per-term
 * parameter still comes from the live advertisement at runtime.
 */
export const KNOWN_COMPLEXITY_FORMULA_VERSIONS: ReadonlySet<string> = new Set(
  COMPLEXITY_FORMULA_SPECS.keys(),
);

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
  /**
   * v5+: factor flips priced iff include_factor_flips. PLoT sends this
   * UNCONDITIONALLY on every base call (`translator-v3.ts:634`), so the term is
   * always in ISL's real price — it is not optional and must not be skipped.
   * Pinned against the translator by `tests/isl-cost-request-shape.test.ts`.
   */
  includeFactorFlips: boolean;
  /**
   * v5+: Σ over control candidates of `len(candidate.values)` — the EVPC do()
   * grid size. ISL prices `evpc_coef·S·W·gridPoints` whenever the request
   * carries control candidates (NOT gated on include_voi).
   *
   * ⚠ PLoT sends NO `control_candidates` today — the field does not exist in the
   * outbound request type (`ISLRobustnessRequestV3`) or anywhere in `src/` — so
   * this is structurally 0 on every real call. It is modelled anyway because the
   * coefficient IS advertised and must be priced the moment a caller can supply
   * a grid; shipping the term now means the wiring cannot be added without the
   * cost following it. The zero is pinned, not assumed:
   * `tests/isl-cost-request-shape.test.ts` REDs if the translator ever starts
   * sending control candidates while this stays hard-zero.
   */
  controlGridPoints: number;
  /**
   * v6+: the outbound request may carry a LEVEL-framed `goal_threshold`, for
   * which ISL runs one extra whole-graph SCM evaluation per Monte Carlo draw
   * (the status-quo reference, ROADMAP 2.286) — S·W units with no option factor.
   *
   * ⚠ THIS IS AN UPPER BOUND, NOT AN EXACT MIRROR, AND DELIBERATELY SO. Depth
   * planning happens BEFORE `effectiveGoalThreshold` is finalised in the route
   * (precedence routing, auto-synthesis and the domain-bound guard can all still
   * clear it), and ISL's own gate additionally requires a convertible goal —
   * attested baseline, parents, no pinning intervention. Reproducing either set
   * of preconditions here would be a second copy of someone else's decision
   * procedure, and a drift between the copies would UNDER-price (trap 12). So
   * PLoT charges on what it knows at plan time — a target was stated and the
   * node attests `level` — which over-charges only requests ISL then declines to
   * run the phase for. Conservative, never permissive: the same rule the
   * uniqueParamUncertainties count follows.
   */
  levelFramedGoalThreshold: boolean;
}

/**
 * Read a per-term structural parameter from the ADVERTISED `formula_parameters`.
 *
 * There is deliberately NO default and NO fallback constant: a version that
 * needs a parameter declares it in {@link COMPLEXITY_FORMULA_SPECS} and the
 * resolver refuses to admit that version until the live advertisement carries
 * it. If this ever throws, a caller has bypassed the resolver — which is a bug,
 * not a condition to paper over with ISL's constant copied into PLoT.
 */
function coefficient(weights: ISLComputeAdmissionWeights, key: string): number {
  const value = (weights as unknown as Record<string, unknown>)[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `ISL compute_admission.weights.${key} is absent or non-finite — this version must not have been admitted`,
    );
  }
  return value;
}

function formulaParameter(
  params: ISLComputeAdmissionFormulaParameters,
  term: 'factor_flips' | 'sensitivity' | 'alternative_winners',
  name: string,
): number {
  const group = (params as unknown as Record<string, Record<string, number> | undefined>)[term];
  const value = group?.[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `ISL formula_parameters.${term}.${name} is absent or non-finite — this version must not have been admitted`,
    );
  }
  return value;
}

/**
 * The edge-sensitivity sub-sweep depth, `min(cap, ⌊S/divisor⌋)`.
 *
 * ⚠ ROADMAP 2.260 — both numbers WERE HARD-CODED here as `min(100, ⌊S/10⌋)`.
 * ISL's completeness audit (PR #119) found the same two literals bare in three
 * places inside its own cost model, so a retune of the sub-sweep would have
 * silently mis-priced this term for every consumer. They are now advertised at
 * `formula_parameters.sensitivity` and read at runtime. Shared by BOTH
 * estimators so there is exactly one implementation of the sub-sweep shape.
 */
function sensitivitySubsampleDepth(
  nSamples: number,
  params: ISLComputeAdmissionFormulaParameters,
): number {
  const cap = formulaParameter(params, 'sensitivity', 'subsample_cap');
  const divisor = formulaParameter(params, 'sensitivity', 'subsample_divisor');
  return Math.min(cap, Math.floor(nSamples / divisor));
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
 *        + sensitivity_coef·E·min(cap, ⌊S/divisor⌋)·W        (edge sensitivity)
 *        + evalue_coef·E·O                                   (e-values)
 *        + bands_coef·E·O                                    (bands, ride on e-values)
 *        + path_coef·min(max_decomposition_paths, E·E)       (path decomposition)
 *   where W = N + E (per-evaluate structural work), and the sensitivity
 *   sub-sweep cap/divisor come from the advertised `formula_parameters`.
 */
export function estimateWeightedCostV2(
  req: WeightedCostRequest,
  weights: ISLComputeAdmissionWeights,
  formulaParameters: ISLComputeAdmissionFormulaParameters,
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
    cost += weights.sensitivity_coef * E * sensitivitySubsampleDepth(S, formulaParameters) * W;
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

/**
 * Weighted compute-admission cost for the `v5-factor-flips-2026-08-01` shape.
 *
 * Derived TERM BY TERM from ISL `src/services/robustness_analyzer_v2.py`
 * `compute_weighted_cost` at PR #119 head `aba52131` (line refs below are that
 * file). As with v2, this hard-codes ONLY the structural shape — which
 * advertised number multiplies what — and never a numeric value.
 *
 *   cost = base·S·O·W                                     :511  base MC, always
 *        + (U+1)·min(S, evpi_sample_cap)·O·W              :527  EVPI, if voi & U>0
 *        + evppi_full_coef·U·(1+K)·S                      :529  full-pop EVPPI, ditto
 *        + evpc_coef·S·W·gridPoints                       :543  EVPC, if grid > 0
 *        + sensitivity_coef·E·min(cap, ⌊S/divisor⌋)·W     :547  edge sensitivity
 *        + influence_walk_pool                            :559  structural influence
 *        + evalue_coef·E·O                                :566  e-values
 *        + bands_coef·E·O                                 :567  bands
 *        + factor_flip_coef·O·(1+2N+2C·(max(O−1,0)+B))·W  :578  factor flips
 *        + path_coef·min(max_decomposition_paths, E·E)    :582  path decomposition
 *
 * where K = `evppi_null_permutations`, C = `formula_parameters.factor_flips
 * .max_candidates`, B = `.stability_seeds`, and W = N + E.
 *
 * Four of these terms did not exist in v2 (`evppi_full`, `evpc`,
 * `structural_influence`, `factor_flips`) — the measured 43% under-count that
 * made admitting v5 unsafe until now
 * (`PHASE0-EVIDENCE-2026-07-28/measure-2260-skew-fallback.md` §6.2).
 *
 * ⚠ Three gating subtleties, each mirrored deliberately from ISL's source
 * rather than assumed — getting any of them wrong under-prices silently:
 *  - `evppi_full` shares EVPI's gate (`include_voi` AND U>0) but has NO `O`
 *    factor: ISL shares one multi-RHS SVD across options (:534-536).
 *  - `structural_influence` is gated on sensitivity AND U>0, and NOT on
 *    `include_voi` (:557-559) — a different gate from EVPI's.
 *  - `evpc` is gated on the control grid ALONE, NOT on `include_voi` (:539-541);
 *    control is a distinct capability from information.
 */
export function estimateWeightedCostV5(
  req: WeightedCostRequest,
  weights: ISLComputeAdmissionWeights,
  formulaParameters: ISLComputeAdmissionFormulaParameters,
): number {
  const S = req.nSamples;
  const O = req.optionCount;
  const N = req.nodeCount;
  const E = req.edgeCount;
  const W = N + E;
  const U = req.uniqueParamUncertainties;

  // Every coefficient is read through `coefficient()` rather than by direct
  // property access. Five of v5's twelve keys are OPTIONAL on
  // ISLComputeAdmissionWeights (a v2 block does not carry them), so direct
  // access would yield `undefined` -> NaN on a mis-admitted block — a plan built
  // on NaN collapses to the sample floor SILENTLY, which is this lane's own
  // defect class. The guard converts that into a loud throw the planner catches.
  let cost = coefficient(weights, 'base_per_sample_per_option_per_struct') * S * O * W;

  if (req.includeVoi && U > 0) {
    cost += (U + 1) * Math.min(S, coefficient(weights, 'evpi_sample_cap')) * O * W;
    // Full-population EVPPI (S2 regression) — runs on the FULL S, never the
    // EVPI subsample, and is deliberately O-flat.
    const K = coefficient(weights, 'evppi_null_permutations');
    cost += coefficient(weights, 'evppi_full_coef') * U * (1 + K) * S;
  }
  if (req.controlGridPoints > 0) {
    cost += coefficient(weights, 'evpc_coef') * S * W * req.controlGridPoints;
  }
  if (req.includeSensitivity) {
    cost +=
      coefficient(weights, 'sensitivity_coef') *
      E *
      sensitivitySubsampleDepth(S, formulaParameters) *
      W;
    // Structural influence — a FLAT charge at the request-wide walk-pool
    // ceiling, not a per-unit coefficient.
    if (U > 0) {
      cost += coefficient(weights, 'influence_walk_pool');
    }
  }
  if (req.includeEValues) {
    cost += coefficient(weights, 'evalue_coef') * E * O;
    cost += coefficient(weights, 'bands_coef') * E * O;
  }
  if (req.includeFactorFlips) {
    const C = formulaParameter(formulaParameters, 'factor_flips', 'max_candidates');
    const B = formulaParameter(formulaParameters, 'factor_flips', 'stability_seeds');
    const evaluates = O * (1 + 2 * N + 2 * C * (Math.max(O - 1, 0) + B));
    cost += coefficient(weights, 'factor_flip_coef') * evaluates * W;
  }
  if (req.includePathDecomposition) {
    cost +=
      coefficient(weights, 'path_coef') *
      Math.min(coefficient(weights, 'max_decomposition_paths'), E * E);
  }
  return cost;
}

/**
 * Weighted compute-admission cost for the `v6-status-quo-alt-winners-2026-08-03`
 * shape (ROADMAP 2.356).
 *
 * v6 = v5 plus the two terms whose evaluator work v5 performed and never
 * charged for. Derived term by term from ISL `compute_weighted_cost`:
 *
 *   + status_quo_coef·S·W                                    if a LEVEL-framed
 *                                                            goal_threshold
 *   + alt_winner_coef·O·(1 + min(E, max_edges)·k_samples)·W  rides on SENSITIVITY
 *
 * Two gating subtleties, both mirrored from ISL's source rather than assumed:
 *
 *  - `status_quo` has NO option factor. The reference draw is shared across
 *    every option by construction (common random numbers), so it is S
 *    evaluations, not S·O. Multiplying by O here would over-charge by O−1 and
 *    shrink admissible depth for no reason.
 *  - `alternative_winners` is gated on SENSITIVITY, not on a flag of its own.
 *    ISL derives its fragile-edge set from the sensitivity results, so with no
 *    sensitivity phase the sweep performs zero evaluations. It is priced at the
 *    CAP (`min(E, max_edges)` edges), not at the actual fragile count — which is
 *    data-dependent and unknowable before the run. That is the direction that
 *    makes it a bound.
 *
 * Everything else is v5 unchanged, and is delegated rather than re-typed:
 * duplicating ten terms so two could be appended is how the two copies drift.
 */
export function estimateWeightedCostV6(
  req: WeightedCostRequest,
  weights: ISLComputeAdmissionWeights,
  formulaParameters: ISLComputeAdmissionFormulaParameters,
): number {
  let cost = estimateWeightedCostV5(req, weights, formulaParameters);

  if (req.levelFramedGoalThreshold) {
    cost += coefficient(weights, 'status_quo_coef') * req.nSamples * (req.nodeCount + req.edgeCount);
  }

  if (req.includeSensitivity) {
    const maxEdges = formulaParameter(formulaParameters, 'alternative_winners', 'max_edges');
    const kSamples = formulaParameter(
      formulaParameters,
      'alternative_winners',
      'marginal_k_samples',
    );
    const evaluates = req.optionCount * (1 + Math.min(req.edgeCount, maxEdges) * kSamples);
    cost += coefficient(weights, 'alt_winner_coef') * evaluates * (req.nodeCount + req.edgeCount);
  }

  return cost;
}

/** Which planning mode produced a {@link DepthPlanDecision}. */
export type DepthPlanMode = 'weighted' | 'legacy_fallback';

/**
 * WHY a planned depth ended up below the requested/defaulted depth. The two
 * causes are genuinely different and must not be reported with one message:
 *
 *  - `admission_budget` — the graph's cost exceeds the admission ceiling, so the
 *    depth was lowered to the largest value that fits. The reduction is a
 *    property of THIS GRAPH.
 *  - `admission_unavailable` — PLoT could not confirm ISL's live admission
 *    capability (unreachable /health, a malformed block, an unknown formula
 *    version or unrecognised weight keys), so it planned conservatively and
 *    DISABLED the depth-raise. The reduction is a property of the SERVICE SEAM,
 *    not of the graph, and the same graph would run at full depth once the
 *    handshake is healthy. ROADMAP 2.260: this case previously produced
 *    `kind: 'unchanged'` and was therefore invisible on the wire.
 */
export type DepthReductionReason = 'admission_budget' | 'admission_unavailable';

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
      /**
       * The depth the caller asked for (explicit) or that the standard default
       * resolved to — ALWAYS the true pre-reduction depth, never an
       * intermediate already lowered by the conservative fallback.
       */
      originalNSamples: number;
      /** cost at the ORIGINAL depth. */
      cost: number;
      /** cost at the REDUCED depth. */
      reducedCost: number;
      ceiling: number;
      mode: DepthPlanMode;
      /** WHY the depth was lowered — drives the user-facing disclosure. */
      reason: DepthReductionReason;
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
   * True whenever ISL is configured but no version-validated admission is in
   * hand — a genuine skew with nothing retained, or the cold `warming` window —
   * the fail-loud posture: DISABLE the depth-raise (cap a defaulted depth to
   * {@link LEGACY_BASE_N_SAMPLES}) and use the conservative
   * {@link LEGACY_FALLBACK_SCALAR_BUDGET}. False (default: true when omitted)
   * ONLY for the truly benign no-gate state (ISL not configured — nothing
   * downstream to refuse the request): standard depth, historical scalar
   * budget, exactly as before the handshake existed.
   *
   * ⚠ ROADMAP 2.289 — the cold warm-up used to be listed here as benign. That
   * was the hole: a cold cache planned full depth against the 30M scalar,
   * which UNDER-prices v5 (see LEGACY_FALLBACK_SCALAR_BUDGET), and ISL
   * refused the forwarded request with a raw 422. The route now derives this
   * flag via compute-admission.ts `shouldPlanConservatively`.
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
  const weighted = admission === null ? null : tryPlanWeighted(input, admission);
  return weighted ?? planLegacyFallback(input, opts.conservative ?? true);
}

/**
 * Attempt weighted planning; return `null` when this admission cannot be priced,
 * so the caller falls back conservatively.
 *
 * ⚠ THIS IS THE FAIL-CLOSED GATE, and it is deliberately belt-AND-braces with
 * the resolver. `compute-admission.ts` classify() already refuses to hand over a
 * block whose version is unknown, whose coefficients are missing, or whose
 * per-term `formula_parameters` are absent — but `planSampleDepth` is exported
 * and takes an admission argument directly, so it re-derives the guarantee here
 * rather than trusting its caller. Three ways out, all to the conservative
 * fallback, none of them silent about the depth (PR #302 made the reduction
 * loud on the wire):
 *
 *  1. no spec for the advertised version — PLoT has no estimator for that shape;
 *  2. a required per-term parameter is missing from `formula_parameters` — this
 *     is the DEPLOY-ORDER case. PLoT deployed ahead of ISL PR #119 reads a v5
 *     block with NO `formula_parameters` and lands here, priced by nobody,
 *     rather than substituting ISL's constants from memory;
 *  3. the estimator threw or produced a non-finite cost — a NaN cost would
 *     otherwise sail through every `<=` comparison in the binary search below
 *     and collapse the plan to ADAPTIVE_N_SAMPLES_FLOOR, i.e. a silent
 *     1,000-sample run. Refusing to plan is strictly safer than planning on NaN.
 */
function tryPlanWeighted(
  input: DepthPlanInput,
  admission: ISLComputeAdmission,
): DepthPlanDecision | null {
  const spec = COMPLEXITY_FORMULA_SPECS.get(admission.complexity_formula_version);
  if (spec === undefined) return null;
  if (!hasRequiredFormulaParameters(spec, admission)) return null;

  const params = admission.formula_parameters ?? {};
  const weights = admission.weights;
  const costAt = (s: number): number => spec.estimate({ ...input, nSamples: s }, weights, params);

  let requestedCost: number;
  try {
    requestedCost = costAt(input.nSamples);
  } catch {
    return null;
  }
  if (!Number.isFinite(requestedCost)) return null;

  return planWeighted(input, admission, costAt, requestedCost);
}

/**
 * Is every per-term parameter this formula shape's estimator reads present and
 * finite in the live advertisement? Mirrors the resolver's check so a direct
 * caller of {@link planSampleDepth} gets the same fail-closed guarantee.
 */
export function hasRequiredFormulaParameters(
  spec: ComplexityFormulaSpec,
  admission: ISLComputeAdmission,
): boolean {
  if (spec.formulaParameters.size === 0) return true;
  const advertised = admission.formula_parameters as
    | Record<string, Record<string, unknown> | undefined>
    | undefined;
  if (!advertised || typeof advertised !== 'object') return false;
  for (const [term, names] of spec.formulaParameters) {
    const group = advertised[term];
    if (!group || typeof group !== 'object') return false;
    for (const name of names) {
      if (!isFiniteNumberValue(group[name])) return false;
    }
  }
  return true;
}

function isFiniteNumberValue(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Weighted planning against the live advertised ceiling + weights. */
function planWeighted(
  input: DepthPlanInput,
  admission: ISLComputeAdmission,
  costAt: (s: number) => number,
  requestedCost: number,
): DepthPlanDecision {
  const ceiling = resolveWeightedCostCeiling(admission.max_cost_units);
  const requested = input.nSamples;

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
    reason: 'admission_budget',
  };
}

/**
 * Legacy scalar fallback (no usable weighted admission). Maps
 * {@link applyComplexityBudget} into the generic decision shape.
 *
 * `conservative` (admission unknown while ISL is configured — skew with nothing
 * retained, or the cold warming window): scalar gate at
 * `min(LEGACY_FALLBACK_SCALAR_BUDGET, env clamp)` AND a DEFAULTED depth capped to
 * {@link LEGACY_BASE_N_SAMPLES} (depth-raise disabled) — the fail-loud posture.
 * Otherwise (ISL absent, no gate to plan against): the historical scalar budget
 * (`resolveComplexityBudget()`, 30M default) at the standard depth — byte-for-byte
 * the pre-handshake behaviour. Either way this path is a DAMAGE LIMITER: scalar
 * arithmetic cannot promise admission against a weighted gate it cannot see
 * (ROADMAP 2.289 — see LEGACY_FALLBACK_SCALAR_BUDGET).
 */
function planLegacyFallback(input: DepthPlanInput, conservative: boolean): DepthPlanDecision {
  // The depth the caller actually asked for (explicit) or that the standard
  // default resolved to. EVERY branch below reports reductions against THIS
  // number — see the ROADMAP 2.260 note under `raiseDisabled`.
  const requested = input.nSamples;

  // Disable the depth-raise for a DEFAULTED depth ONLY under a genuine skew;
  // explicit caller depths pass through to the budget check untouched (never
  // silently raised or lowered except by the reduction/refusal below).
  //
  // ⚠ ROADMAP 2.260 — THIS CAP USED TO BE INVISIBLE. It was applied BEFORE
  // applyComplexityBudget, which then saw the already-lowered `planned`, found
  // it fitted, and returned `kind: 'unchanged'`. The route only sets
  // `meta.originalNSamples` on a `reduced` decision, so a defaulted 10,000 →
  // 4,000 cut (−60% Monte Carlo depth) reached the user with NO
  // SAMPLES_REDUCED_FOR_COMPLEXITY warning and every confidence marker green.
  // Measured live on staging 1 Aug 2026 (PHASE0-EVIDENCE-2026-07-28/
  // measure-2260-skew-fallback.md). The cap itself is CORRECT — planning at a
  // depth ISL may refuse is worse — but it must be disclosed, so the depth loss
  // is now reported against `requested` and surfaces as a first-class reduction.
  const raiseDisabled =
    conservative && !input.nSamplesExplicit && requested > LEGACY_BASE_N_SAMPLES;
  const planned = raiseDisabled ? LEGACY_BASE_N_SAMPLES : requested;

  const budget = conservative
    ? Math.min(LEGACY_FALLBACK_SCALAR_BUDGET, resolveComplexityBudget())
    : resolveComplexityBudget();
  const scalar = applyComplexityBudget(planned, input.nodeCount, input.edgeCount, budget);

  if (scalar.kind === 'refused') {
    return {
      kind: 'refused',
      // The caller's depth, not the conservatively-capped intermediate.
      originalNSamples: requested,
      costAtFloor: ADAPTIVE_N_SAMPLES_FLOOR * scalar.nodeEdgeProduct,
      ceiling: budget,
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      mode: 'legacy_fallback',
    };
  }

  // Single exit for BOTH ways a depth can end up below what was asked for: the
  // raise-disable cap and/or the scalar budget. Collapsing them here is what
  // stops the cap from hiding inside a `kind: 'unchanged'`.
  const finalNSamples = scalar.nSamples;
  const product = input.nodeCount * input.edgeCount;
  if (finalNSamples < requested) {
    return {
      kind: 'reduced',
      nSamples: finalNSamples,
      originalNSamples: requested,
      cost: requested * product,
      reducedCost: finalNSamples * product,
      ceiling: budget,
      mode: 'legacy_fallback',
      // When the raise-disable contributed, the SEAM is the cause the user
      // needs to hear — it is not a property of their graph, and the same graph
      // runs at full depth once the handshake is healthy. (A budget reduction
      // stacked on top does not change that attribution.)
      reason: raiseDisabled ? 'admission_unavailable' : 'admission_budget',
    };
  }
  return {
    kind: 'unchanged',
    nSamples: finalNSamples,
    cost: scalar.complexity,
    ceiling: budget,
    mode: 'legacy_fallback',
  };
}

// ---------------------------------------------------------------------------
// Codex F8 handshake — STRUCTURAL CAPS gate (the CAPS half of the handshake)
// ---------------------------------------------------------------------------
//
// ISL advertises structural caps on /health (`compute_admission.caps`:
// max_nodes / max_edges / max_options / max_parameter_uncertainties) SPECIFICALLY
// so PLoT can pre-check them and refuse BEFORE calling ISL — rather than forward
// a request ISL is guaranteed to reject with a raw Pydantic 422. #233 completed
// the COST half (planSampleDepth against max_cost_units); THIS is the CAPS half.
//
// DERIVE-DON'T-MIRROR (programme trap #12):
//   - parameter_uncertainties is the genuinely un-mirrored dimension — PLoT has
//     NO LIMITS twin and NO other check for it — so the advertised cap is the
//     sole gate. Before this, a >cap-PU graph passed PLoT and 422'd at ISL.
//   - nodes / edges / options are checked against min(PLoT LIMITS, advertised
//     cap): the advertised cap RETIRES the drift between PLoT's LIMITS mirror
//     and ISL's pin (a cap ISL tightened BELOW PLoT's LIMITS now bites here),
//     while PLoT's own LIMITS stay as the belt-and-braces LOWER bound (a
//     garbage-high advertised cap can never WIDEN what PLoT admits). PLoT's
//     preflight LIMITS checks elsewhere are untouched — this is scoped to the
//     admission-planning path only.

/** PLoT-side structural safety LIMITS — the belt-and-braces lower bound. */
export interface StructuralSafetyLimits {
  maxNodes: number;
  maxEdges: number;
  maxOptions: number;
}

/** The structural counts a request will send to ISL, for the caps gate. */
export interface AdmissionCapsInput {
  /** N — causal node count ISL will receive. */
  nodeCount: number;
  /** E — causal (directed) edge count ISL will receive. */
  edgeCount: number;
  /** O — option count ISL will receive. */
  optionCount: number;
  /** U — number of UNIQUE parameter uncertainties (factor + injected constraint). */
  uniqueParamUncertainties: number;
}

/** Which structural dimension breached its admission cap. */
export type AdmissionCapDimension = 'parameter_uncertainties' | 'nodes' | 'edges' | 'options';

/** Outcome of the structural caps gate. */
export type AdmissionCapsDecision =
  | { kind: 'ok' }
  | {
      kind: 'exceeded';
      /** The dimension that breached (named in the refusal message). */
      dimension: AdmissionCapDimension;
      /** Observed count in the request. */
      observed: number;
      /** Enforced limit: the advertised cap (PU) or min(LIMITS, cap) (structural). */
      limit: number;
      /** Which side produced the binding limit — for logging/telemetry. */
      source: 'isl_cap' | 'plot_limit';
    };

/**
 * Check a request's structural counts against ISL's advertised caps BEFORE the
 * ISL call — the CAPS half of the /health handshake.
 *
 * Applies ONLY when caps are advertised-and-valid (`admission` non-null; the
 * resolver has already version-checked the block and validated `caps`). When
 * `admission` is null (skew with nothing retained, ISL unconfigured, or the
 * cold warm-up before the first /health read) this returns `{ kind: 'ok' }` —
 * NO spurious caps refusal; the conservative cost-gate fallback governs exactly
 * as before, mirroring planSampleDepth's posture so the two halves stay
 * consistent. ROADMAP 2.289 note: last-known-good RETENTION (compute-admission
 * .ts) keeps `admission` non-null through a transient /health outage, so this
 * gate now stays live in exactly the window that used to disable it.
 *
 * First breach wins; parameter_uncertainties is checked FIRST because it is the
 * dimension PLoT has no other means to catch.
 */
export function checkAdmissionCaps(
  input: AdmissionCapsInput,
  admission: ISLComputeAdmission | null,
  limits: StructuralSafetyLimits,
): AdmissionCapsDecision {
  if (admission === null) return { kind: 'ok' };
  const caps = admission.caps;

  // U — the genuinely un-checkable dimension: no PLoT LIMITS twin, so the
  // advertised cap is the sole gate.
  if (input.uniqueParamUncertainties > caps.max_parameter_uncertainties) {
    return {
      kind: 'exceeded',
      dimension: 'parameter_uncertainties',
      observed: input.uniqueParamUncertainties,
      limit: caps.max_parameter_uncertainties,
      source: 'isl_cap',
    };
  }

  // Structural dimensions — enforce min(PLoT LIMITS, advertised cap).
  const structural: ReadonlyArray<{
    dimension: AdmissionCapDimension;
    observed: number;
    plotLimit: number;
    islCap: number;
  }> = [
    { dimension: 'nodes', observed: input.nodeCount, plotLimit: limits.maxNodes, islCap: caps.max_nodes },
    { dimension: 'edges', observed: input.edgeCount, plotLimit: limits.maxEdges, islCap: caps.max_edges },
    { dimension: 'options', observed: input.optionCount, plotLimit: limits.maxOptions, islCap: caps.max_options },
  ];
  for (const { dimension, observed, plotLimit, islCap } of structural) {
    const limit = Math.min(plotLimit, islCap);
    if (observed > limit) {
      return {
        kind: 'exceeded',
        dimension,
        observed,
        limit,
        // The advertised cap binds iff it is the (strictly) tighter of the two.
        source: islCap < plotLimit ? 'isl_cap' : 'plot_limit',
      };
    }
  }

  return { kind: 'ok' };
}
