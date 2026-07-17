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
 * ISL's request-complexity budget: it rejects (422) any robustness request
 * where `n_samples × nodes × edges` STRICTLY exceeds this
 * (Inference-Service-Layer src/api/robustness.py, `complexity > max_complexity`,
 * default 10,000,000, env `ISL_MAX_COMPUTE_COMPLEXITY`). At PLoT's standard
 * depth of 4,000 that walled off every causal graph with nodes × edges > 2,500
 * — real dense decision graphs hit a raw ISL 422 on the live path (verified:
 * acceptance-evidence/dense-graph-test attempt 6, 43 × 70 causal = 12,040,000).
 * PLoT mirrors the budget so it can adapt the depth BEFORE calling ISL.
 *
 * Paul-ruled lenient defaults 2026-07-17: raised 10M → 30M. Without this the
 * base-depth raise (STANDARD_N_SAMPLES_DEFAULT 4000 → 10000) silently no-ops
 * on any graph with filtered nodes × edges > 1000: the A3 budget-scout
 * measured a 40n/120e graph at requested K=10000 being adaptively clamped
 * back to n=4873 under the 10M budget (budget-review.md task 2e) — the
 * silent-cap class. 30M keeps the worst-fit dense-graph base call inside the
 * ISL client timeout with margin (scout: ~15-17 s staging); do NOT jump to
 * 100M, which would breach it.
 *
 * ⚠ DEPLOY-ORDER COUPLING: ISL enforces the SAME budget (env
 * `ISL_MAX_COMPUTE_COMPLEXITY`, ISL code default 10M at tip 5745154e). If
 * PLoT's mirror is 30M while ISL still enforces 10M, PLoT under-reduces and
 * dense graphs get a raw ISL 422 instead of today's disclosed adaptive
 * reduction. ISL's matching raise (or `ISL_MAX_COMPUTE_COMPLEXITY=30000000`
 * set on BOTH services) must land BEFORE or WITH this deploy — recorded as a
 * CALLER ASK in the lane-5 PR.
 */
export const ISL_COMPLEXITY_BUDGET_DEFAULT = 30_000_000;

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
 * Resolve the complexity budget PLoT enforces before calling ISL.
 *
 * Env `ISL_MAX_COMPUTE_COMPLEXITY` — the SAME variable name ISL reads — so
 * ops can keep the two services in lock-step with one value. Strictly parsed
 * (see env-int.ts); malformed or out-of-bounds values fall back to the
 * default rather than silently widening/narrowing the gate. Read at call
 * time so an override takes effect without a rebuild.
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
): ComplexityBudgetDecision {
  const budget = resolveComplexityBudget();
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
