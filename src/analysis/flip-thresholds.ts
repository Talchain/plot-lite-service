/**
 * Flip Threshold Binary Search
 *
 * Resolves exact flip_value for candidate flip thresholds by running binary
 * search over ISL inference. A "flip" = the argmax option changes (the winner
 * is no longer the highest win_probability option).
 *
 * ## Algorithm per factor:
 * 0. Probe — evaluate at baseline (b), lower bound (0), upper bound (1)
 * 1. If winner is the same at all three points → no_effect_within_bounds
 * 2. Pick the bound where the winner differs from W0 as the far end
 * 3. Binary search between b and that bound
 * 4. Max iterations derived from precision target: ceil(log2(1 / precision))
 *
 * @see Task 2: Flip threshold computation — binary search over ISL inference
 */

import type { FlipThresholdInputData } from '../cee/validation/m1-review-types.js';
import { computeMarginSensitivity, type MarginSensitivity } from './margin-sensitivity.js';
import { resolveBoundedIntEnvOrWarn, MIN_N_SAMPLES, MAX_N_SAMPLES } from '../config/env-int.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a single ISL inference call for flip threshold search.
 * Only the fields we need: which option has the highest win_probability.
 */
export interface FlipInferenceResult {
  options: Array<{ option_id: string; win_probability: number }>;
}

/**
 * Callback that runs ISL inference with a single factor's value overridden.
 * The caller constructs this closure to encapsulate ISL client + request details.
 *
 * @param factorId - Factor node ID to override
 * @param overrideMean - Normalised [0,1] probe value applied to the factor's graph
 *   `observed_state.value` (the field ISL's comparison reads as the sampling mean);
 *   the factor's `parameter_uncertainties[].mean` is kept aligned to the same value.
 * @returns ISL inference result with option win_probabilities
 */
export type ISLInferenceFn = (
  factorId: string,
  overrideMean: number,
  /**
   * F3 (Codex): optional per-probe cancellation signal. When the factor/overall
   * flip deadline trips, this aborts so an in-flight ISL probe cancels instead of
   * running to completion. Implementations that ignore it still work (no
   * cancellation, unchanged behaviour) — a 2-arg fn stays assignable to this type.
   */
  signal?: AbortSignal
) => Promise<FlipInferenceResult>;

/**
 * Configuration for flip threshold binary search.
 */
export interface FlipSearchConfig {
  /** Max binary search iterations per factor (derived from precision target) */
  maxIterations: number;
  /** Precision target for binary search convergence (default: 0.01) */
  precisionTarget: number;
  /** Number of grid points for non-monotonic fallback (default: 11) */
  maxGridPoints: number;
  /** Per-factor timeout in ms (default: 5000) */
  perFactorTimeoutMs: number;
  /** Overall timeout in ms (default: 10000) */
  overallTimeoutMs: number;
}

/**
 * Paul-ruled lenient defaults 2026-07-17 — flip-search time budgets.
 *
 * Raised from 5_000/10_000 to 10_000/30_000 (per-factor/overall), the values
 * MEASURED by the A3 budget-scout (acceptance-evidence/a3-verify-2026-07-16/
 * budget-review.md, task 2c + ruling table): probes at base depth crowd the
 * old 10 s overall budget (~10 probes × ~700 ms staging at depth 4000), and
 * Paul's ruling is that analysis must not be cut off — a slow search should
 * DISCLOSE itself, not truncate. Worst case with these budgets is ~35 s of
 * flip search, well inside the UI's 120 s client timeout (the binding
 * envelope hop; Render's platform cap is 100 MINUTES and never binds).
 * The overall budget is additionally clamped at the call site
 * (src/routes/v2/run.ts) to the REMAINING request budget so the raised
 * default can never outlive the caller. Timeouts remain fully disclosed:
 * flip_reason 'timeout' per entry + elapsed_ms on every diagnostics entry.
 *
 * ⚠ Watch-item (recorded in the lane-5 PR): with the base-depth raise to
 * 10k, probes run at 10k (min(cap, base)) — ~2.5× the scout's depth-4000
 * probe timings — so factors needing a full bisection may trip the 10 s
 * per-factor budget on staging and disclose 'timeout'. The no-deploy
 * mitigation knob is FLIP_PROBE_N_SAMPLES=4000 (env).
 */
export const DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS = 10_000;
export const DEFAULT_FLIP_OVERALL_TIMEOUT_MS = 30_000;

/**
 * Bounds for the flip-search time-budget env overrides (ms).
 *
 * A budget must be a non-negative integer. `0` is PERMITTED and means an
 * immediate timeout on every factor — the deterministic "disable flip search
 * but keep the per-factor 'timeout' disclosure" knob (used by the disclosure
 * tests). The upper bound is generous (10 min) because the OVERALL budget is
 * additionally clamped to the remaining request budget at the call site — this
 * bound only exists to reject garbage. Routing these through the strict
 * {@link resolveBoundedIntEnvOrWarn} (rather than `parseInt`) closes the
 * NaN/misparse hole: `parseInt('' ?? default)` on an EMPTY env string is `NaN`,
 * and `parseInt('30_000')`/`parseInt('30000abc')` silently return `30`/`30000`.
 * A `NaN` deadline (`Date.now() + NaN`) makes every `Date.now() >= deadline`
 * guard false — defeating every timeout. (`?? DEFAULT` preserves a valid `0`
 * because `0` is non-nullish.)
 */
export const MIN_FLIP_TIMEOUT_MS = 0;
export const MAX_FLIP_TIMEOUT_MS = 600_000;

/** Env-or-default overall flip-search budget (before call-site budget clamping). */
export function resolveFlipOverallTimeoutMs(): number {
  return (
    resolveBoundedIntEnvOrWarn('FLIP_SEARCH_OVERALL_TIMEOUT_MS', MIN_FLIP_TIMEOUT_MS, MAX_FLIP_TIMEOUT_MS) ??
    DEFAULT_FLIP_OVERALL_TIMEOUT_MS
  );
}

/** Env-or-default per-factor flip-search budget. Also caps each probe's ISL call. */
export function resolveFlipPerFactorTimeoutMs(): number {
  return (
    resolveBoundedIntEnvOrWarn('FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS', MIN_FLIP_TIMEOUT_MS, MAX_FLIP_TIMEOUT_MS) ??
    DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS
  );
}

function getDefaultConfig(): FlipSearchConfig {
  const precisionTarget = 0.01;
  return {
    maxIterations: Math.ceil(Math.log2(1 / precisionTarget)),  // ~7 for [0,1]
    precisionTarget,
    maxGridPoints: 11,
    perFactorTimeoutMs: resolveFlipPerFactorTimeoutMs(),
    overallTimeoutMs: resolveFlipOverallTimeoutMs(),
  };
}

/**
 * Flip-probe sample depth cap (probes run at BASE precision up to this cap).
 *
 * Paul-ruled lenient defaults 2026-07-17: raised 1_000 → 10_000. Paul's
 * ruling — prioritise analysis quality and scientific credibility over
 * latency: flip thresholds computed at 1,000 samples while the base analysis
 * runs at 4,000+ meant tipping points were an order of magnitude noisier than
 * the probabilities displayed next to them. Probes now inherit the base
 * analysis depth up to this cap (== MAX_N_SAMPLES, the /v2/run schema bound),
 * so flip values carry the base analysis's precision. The flip-search time
 * budgets were raised in step (see DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS /
 * DEFAULT_FLIP_OVERALL_TIMEOUT_MS); a slow search now DISCLOSES itself
 * (flip_reason 'timeout' + elapsed_ms) instead of silently shipping
 * low-precision values. Track-S decoupling survives as the cap + the
 * FLIP_PROBE_N_SAMPLES env override, no longer as a hard 1,000 floor-pin.
 *
 * The cap DERIVES from `MAX_N_SAMPLES` (the /v2/run schema ceiling) rather than
 * mirroring the `10_000` literal, so the two can never silently diverge.
 */
export const DEFAULT_FLIP_PROBE_N_SAMPLES = MAX_N_SAMPLES;

/**
 * Fallback base depth used ONLY when the caller's base `n_samples` is unknown.
 *
 * An EXPLICIT 4,000 floor — deliberately NOT `STANDARD_N_SAMPLES_DEFAULT`.
 * `STANDARD_N_SAMPLES_DEFAULT` was raised to `MAX_N_SAMPLES` (10,000) on
 * 2026-07-17, so `min(DEFAULT_FLIP_PROBE_N_SAMPLES, STANDARD_N_SAMPLES_DEFAULT)`
 * collapsed to `min(10k, 10k) = 10k` — the exact 10k CAP the docstring below
 * promises to avoid. "Base precision" means matching a typical base depth, not
 * maxing out the probe depth when the base is unknown. On the live route the
 * base depth is always known (resolveStandardNSamples), so this branch is a
 * defensive fallback for direct callers/tests only.
 */
export const FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES = 4_000;

/**
 * Resolve the sample depth to use for flip probes.
 *
 * Precedence:
 *  1. `FLIP_PROBE_N_SAMPLES` env — strictly parsed, in-bounds (100..10000) ops
 *     override (may exceed base); malformed/out-of-bounds values are ignored;
 *  2. otherwise `min(DEFAULT_FLIP_PROBE_N_SAMPLES, baseNSamples)` — probes run
 *     at the base analysis's depth (base precision), capped at 10k; they never
 *     run deeper than the base.
 */
export function resolveFlipProbeNSamples(baseNSamples?: number): number {
  const envOverride = resolveBoundedIntEnvOrWarn('FLIP_PROBE_N_SAMPLES', MIN_N_SAMPLES, MAX_N_SAMPLES);
  if (envOverride !== null) return envOverride;
  // Unknown base depth → the explicit 4,000 floor, never the 10k cap:
  // "base precision" means matching a typical base, not maxing out.
  const base = typeof baseNSamples === 'number' && Number.isFinite(baseNSamples) && baseNSamples > 0
    ? baseNSamples
    : FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES;
  return Math.min(DEFAULT_FLIP_PROBE_N_SAMPLES, base);
}

/**
 * Per-factor diagnostics emitted alongside flip_thresholds_resolved log event.
 */
export interface FlipDiagnostics {
  factor_id: string;
  baseline: number;
  direction_searched: 'toward_min' | 'toward_max' | 'none';
  winner_at_baseline: string;
  winner_at_min: string;
  winner_at_max: string;
  bracket_low: number;
  bracket_high: number;
  /** Binary-search (bisection) iterations only. Grid-fallback probes are NOT
   *  counted here — they count toward `probes_used`. */
  iterations_used: number;
  /**
   * Total probe evaluations COMPLETED for this factor: the 3 Step-0 probes
   * (baseline + both bounds) plus any bisection/grid midpoint probes. Counts
   * completions, not attempts — a probe that rejected is not counted. 0 when
   * the probe phase never ran (pre-probe timeout, non-finite baseline). Lets
   * `iterations_used: 0` be disambiguated: 3 means probes ran but bisection
   * did not; 0 means no probes ran at all.
   */
  probes_used: number;
  precision_target: number;
  precision_achieved: number;
  flip_reason: string;
  flip_value: number | null;
  alternative_winner_id: string | null;
  /**
   * Additive lead-margin diagnostic computed from the Step-0 probes.
   * Omitted on entries where probes did not complete (pre-probe timeout,
   * non-finite baseline, or exception during the parallel probe phase).
   */
  margin_sensitivity?: MarginSensitivity;
  /**
   * Wall-clock ms this factor's search took, stamped on EVERY diagnostics
   * entry (found / timeout / error / no_effect alike). Paul-ruled lenient
   * defaults 2026-07-17: slowness must be VISIBLE — a 'timeout' trip without
   * its elapsed time is an undiagnosable cutoff. Log-only (diagnostics never
   * reach the public response).
   */
  elapsed_ms?: number;
}

// =============================================================================
// Concurrency bound
// =============================================================================

/**
 * Max ISL inference calls in flight at once across a single flip search.
 * Bounds ISL load so a many-candidate / deep-probe search cannot saturate the
 * engine (→ 429s). Pinned; see the concurrency comment in resolveFlipValues.
 */
export const FLIP_MAX_CONCURRENT_ISL_CALLS = 2;

/**
 * Wrap an {@link ISLInferenceFn} so at most `max` invocations run concurrently;
 * excess calls queue FIFO and start as earlier ones settle. A minimal
 * counting-semaphore — no external dependency, order-preserving, and it applies
 * uniformly to every probe of every factor because it wraps the single shared fn.
 */
function limitConcurrency(fn: ISLInferenceFn, max: number): ISLInferenceFn {
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (active < max) {
        active++;
        resolve();
      } else {
        queue.push(() => {
          active++;
          resolve();
        });
      }
    });
  const release = (): void => {
    active--;
    const next = queue.shift();
    if (next) next();
  };
  return async (factorId: string, overrideMean: number, signal?: AbortSignal): Promise<FlipInferenceResult> => {
    await acquire();
    try {
      // Forward the deadline signal so a probe dequeued AFTER the deadline sees an
      // already-aborted signal and short-circuits (see createISLInferenceFn) — this
      // is how a queued probe past the deadline is prevented from starting real work.
      return await fn(factorId, overrideMean, signal);
    } finally {
      release();
    }
  };
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Resolve flip_value for candidate flip thresholds via ISL binary search.
 *
 * Takes the heuristic candidates (from computeFlipThresholdData) and runs
 * binary search over ISL inference to find exact flip points.
 *
 * @param candidates - Heuristic flip threshold candidates (max 2)
 * @param inferenceFn - ISL inference callback
 * @param originalWinnerId - Option ID of the current winner
 * @param config - Search configuration (optional)
 * @returns Enhanced FlipThresholdInputData with resolved flip_value
 */
export async function resolveFlipValues(
  candidates: FlipThresholdInputData[],
  inferenceFn: ISLInferenceFn,
  originalWinnerId: string,
  config?: Partial<FlipSearchConfig>
): Promise<{ results: FlipThresholdInputData[]; diagnostics: FlipDiagnostics[] }> {
  const cfg = { ...getDefaultConfig(), ...config };

  if (candidates.length === 0) {
    return { results: [], diagnostics: [] };
  }

  const overallDeadline = Date.now() + cfg.overallTimeoutMs;
  // Cancellation (F3, Codex): a signal that aborts when the OVERALL flip deadline
  // trips, threaded to every probe so in-flight ISL calls actually cancel. The
  // `Date.now() >= deadline` guards below only fire BETWEEN probes — they cannot
  // interrupt an awaited Promise.allSettled or cancel a queued/in-flight probe.
  // AbortSignal.timeout's internal timer is unref'd, so it never keeps the event
  // loop (or a test process) alive after the search settles.
  const overallTimeoutSignal = AbortSignal.timeout(Math.max(0, cfg.overallTimeoutMs));

  // Cap TOTAL in-flight ISL calls at 2 across the whole flip search. Each factor
  // search issues up to 3 Step-0 probes in parallel (baseline + both bounds), so
  // an unbounded `Promise.all` over N candidates would peak at N×3 concurrent ISL
  // calls — at the raised 10k probe depth that amplifies into ISL saturation/429s.
  // A shared semaphore around inferenceFn bounds the REAL ISL fan-out to
  // FLIP_MAX_CONCURRENT_ISL_CALLS, independent of candidate count or per-factor
  // probe parallelism. (Prior comment claimed "max 2 concurrency" but nothing
  // enforced it — the candidate-level Promise.all was unbounded and each factor
  // fanned out 3-wide underneath.)
  const boundedInferenceFn = limitConcurrency(inferenceFn, FLIP_MAX_CONCURRENT_ISL_CALLS);
  const settled = await Promise.all(
    candidates.map((candidate) =>
      searchFlipForFactor(candidate, boundedInferenceFn, originalWinnerId, cfg, overallDeadline, overallTimeoutSignal)
    )
  );

  const results = settled.map((s) => s.result);
  const diagnostics = settled.map((s) => s.diagnostics);

  return { results, diagnostics };
}

// =============================================================================
// Per-Factor Search
// =============================================================================

/**
 * Search for the flip point of a single factor.
 *
 * Algorithm:
 * 1. Evaluate at baseline (b) → winner W0
 * 2. Evaluate at lower bound (0) → winner W_min
 * 3. Evaluate at upper bound (1) → winner W_max
 * 4. If W_min === W_max === W0 → no_effect_within_bounds
 * 5. Otherwise pick the bound where winner differs from W0 as the far end
 * 6. Binary search between b and that bound
 * 7. Max iterations from precision target: ceil(log2(1 / precision_target))
 */
async function searchFlipForFactor(
  candidate: FlipThresholdInputData,
  inferenceFn: ISLInferenceFn,
  originalWinnerId: string,
  config: FlipSearchConfig,
  overallDeadline: number,
  overallSignal: AbortSignal
): Promise<{ result: FlipThresholdInputData; diagnostics: FlipDiagnostics }> {
  // Stamp elapsed_ms on every diagnostics entry (all exit paths return the
  // shared `diag` object). Paul-ruled lenient defaults 2026-07-17: slowness
  // must be visible, especially on 'timeout' trips.
  const searchStartedAt = Date.now();
  const out = await searchFlipForFactorInner(candidate, inferenceFn, originalWinnerId, config, overallDeadline, overallSignal);
  out.diagnostics.elapsed_ms = Date.now() - searchStartedAt;
  return out;
}

async function searchFlipForFactorInner(
  candidate: FlipThresholdInputData,
  inferenceFn: ISLInferenceFn,
  originalWinnerId: string,
  config: FlipSearchConfig,
  overallDeadline: number,
  overallSignal: AbortSignal
): Promise<{ result: FlipThresholdInputData; diagnostics: FlipDiagnostics }> {
  const factorDeadline = Math.min(Date.now() + config.perFactorTimeoutMs, overallDeadline);
  // Cancellation (F3): abort every probe of THIS factor when either the factor's
  // own deadline or the overall flip deadline trips. Combined with the between-probe
  // `Date.now() >= factorDeadline` guards below, this makes in-flight AND queued
  // probes stop instead of running to completion past the deadline.
  const factorSignal = AbortSignal.any([
    overallSignal,
    AbortSignal.timeout(Math.max(0, factorDeadline - Date.now())),
  ]);

  const baseline = candidate.current_value;

  // Diagnostics accumulator (populated as we go)
  const diag: FlipDiagnostics = {
    factor_id: candidate.factor_id,
    baseline,
    direction_searched: 'none',
    winner_at_baseline: '',
    winner_at_min: '',
    winner_at_max: '',
    bracket_low: 0,
    bracket_high: 0,
    iterations_used: 0,
    probes_used: 0,
    precision_target: config.precisionTarget,
    precision_achieved: Infinity,
    flip_reason: '',
    flip_value: null,
    alternative_winner_id: null,
  };

  // Probe-evaluation counter. Incremented as each ISL inference completes:
  // +3 after the Step-0 probes, +1 per bisection/grid midpoint. Declared
  // outside the try so the catch path can report the count that did complete.
  let probes = 0;

  // Guard: skip binary search if current_value is not a finite number
  if (!Number.isFinite(baseline)) {
    diag.flip_reason = 'error';
    return {
      result: { ...candidate, flip_value: null, flip_reason: 'error', iterations_used: 0, probes_used: 0, alternative_winner_id: null },
      diagnostics: diag,
    };
  }

  try {
    // Step 0: Probe baseline and both bounds
    if (Date.now() >= factorDeadline) {
      diag.flip_reason = 'timeout';
      return {
        result: { ...candidate, flip_value: null, flip_reason: 'timeout', iterations_used: 0, probes_used: 0, alternative_winner_id: null },
        diagnostics: diag,
      };
    }

    // Step-0: probe baseline + both bounds. Use allSettled (NOT Promise.all) so the
    // completed-probe count is ORDER-INDEPENDENT. Promise.all rejects on the first
    // failure and returns immediately, leaving the sibling probes in flight — they
    // complete *after* the result is emitted, so a reject-first ordering would
    // report probes_used: 0 even though two probes do complete. allSettled waits for
    // all three to settle, so probes_used is exactly the number that fulfilled and
    // no probe completes after emission.
    //
    // We deliberately do NOT race a per-probe timeout here: abandoning a probe would
    // let it complete in the background after emission, reintroducing the same
    // dishonesty. Boundedness relies on ISL's own HTTP-layer timeout (each probe
    // settles fulfilled or rejected); true in-flight bounding would require request
    // cancellation (AbortController), which is out of scope for this telemetry fix.
    const settled = await Promise.allSettled([
      inferenceFn(candidate.factor_id, baseline, factorSignal),
      inferenceFn(candidate.factor_id, 0, factorSignal),
      inferenceFn(candidate.factor_id, 1, factorSignal),
    ]);
    probes += settled.filter((s) => s.status === 'fulfilled').length;

    // Any Step-0 probe failing → error, with the honest count of probes that did
    // complete. (margin_sensitivity is intentionally omitted, as on the catch path.)
    // Cancellation (F3): a rejection AFTER the deadline is a cancelled probe, not
    // an ISL fault — disclose it as 'timeout' (the same status the between-probe
    // guards use), else 'error'. Never relabel a genuine failure as a timeout.
    if (settled.some((s) => s.status === 'rejected')) {
      const reason: 'timeout' | 'error' =
        (Date.now() >= factorDeadline || factorSignal.aborted) ? 'timeout' : 'error';
      diag.flip_reason = reason;
      diag.probes_used = probes;
      return {
        result: { ...candidate, flip_value: null, flip_reason: reason, iterations_used: 0, probes_used: probes, alternative_winner_id: null },
        diagnostics: diag,
      };
    }

    const [baselineResult, minResult, maxResult] = (
      settled as PromiseFulfilledResult<FlipInferenceResult>[]
    ).map((s) => s.value);

    const W0 = getArgmaxOption(baselineResult);
    const W_min = getArgmaxOption(minResult);
    const W_max = getArgmaxOption(maxResult);

    diag.winner_at_baseline = W0;
    diag.winner_at_min = W_min;
    diag.winner_at_max = W_max;

    // Margin-sensitivity diagnostic — computed once from the three already-fetched
    // probe results. Strict-flip detected iff either bound's argmax differs from
    // baseline's argmax. Attached to every probe-completed return below.
    const strictFlipDetected = W_min !== W0 || W_max !== W0;
    const marginSensitivity = computeMarginSensitivity({
      baseline: baselineResult,
      min: minResult,
      max: maxResult,
      strictFlipDetected,
    });
    diag.margin_sensitivity = marginSensitivity;

    // Step 1: If winner is the same at baseline and both bounds → factor cannot flip
    if (W_min === W0 && W_max === W0) {
      diag.flip_reason = 'no_effect_within_bounds';
      diag.iterations_used = 0;
      diag.probes_used = probes;
      return {
        result: { ...candidate, flip_value: null, flip_reason: 'no_effect_within_bounds', iterations_used: 0, probes_used: probes, alternative_winner_id: null, margin_sensitivity: marginSensitivity },
        diagnostics: diag,
      };
    }

    // Step 2: Pick the bound where winner differs from W0.
    // Prefer the candidate's heuristic direction when both bounds differ.
    let searchLow: number;
    let searchHigh: number;
    let farWinner: string;

    const minDiffers = W_min !== W0;
    const maxDiffers = W_max !== W0;

    if (minDiffers && maxDiffers) {
      // Both bounds produce different winners — use heuristic direction
      if (candidate.direction === 'decrease') {
        searchLow = 0;
        searchHigh = baseline;
        farWinner = W_min;
        diag.direction_searched = 'toward_min';
      } else {
        searchLow = baseline;
        searchHigh = 1;
        farWinner = W_max;
        diag.direction_searched = 'toward_max';
      }
    } else if (minDiffers) {
      // Only lower bound flips → search toward 0
      searchLow = 0;
      searchHigh = baseline;
      farWinner = W_min;
      diag.direction_searched = 'toward_min';
    } else {
      // Only upper bound flips → search toward 1
      searchLow = baseline;
      searchHigh = 1;
      farWinner = W_max;
      diag.direction_searched = 'toward_max';
    }

    diag.bracket_low = searchLow;
    diag.bracket_high = searchHigh;

    // Step 3: Binary search between baseline and the differing bound.
    // Track winners at both ends of the search interval:
    //   toward_min: low=0 (farWinner), high=baseline (W0)
    //   toward_max: low=baseline (W0), high=1 (farWinner)
    const lowSideWinner = (diag.direction_searched === 'toward_min') ? farWinner : W0;
    const highSideWinner = (diag.direction_searched === 'toward_min') ? W0 : farWinner;
    let iterations = 0;

    for (let i = 0; i < config.maxIterations; i++) {
      if (Date.now() >= factorDeadline) {
        // The bracket midpoint is a partial-search artefact: where the bisection
        // happened to stop when the wall-clock deadline hit, NOT a converged
        // threshold. It must never be surfaced as a usable `flip_value`. We keep
        // it (and the far winner) in `diag` only — diagnostics are log-only and
        // never reach the public response — and emit a null-threshold result so
        // downstream consumers classify this as unresolved. `margin_sensitivity`
        // is retained: it reflects the completed Step-0 probes (a real finding
        // that the winner changes within bounds), independent of the timeout.
        const partialMidpoint = roundTo4(midpoint(searchLow, searchHigh));
        diag.iterations_used = iterations;
        diag.probes_used = probes;
        diag.precision_achieved = Math.abs(searchHigh - searchLow);
        diag.flip_reason = 'timeout';
        diag.flip_value = partialMidpoint;
        diag.alternative_winner_id = farWinner;
        return {
          result: { ...candidate, flip_value: null, flip_reason: 'timeout', iterations_used: iterations, probes_used: probes, alternative_winner_id: null, margin_sensitivity: marginSensitivity },
          diagnostics: diag,
        };
      }

      if (Math.abs(searchHigh - searchLow) <= config.precisionTarget) {
        break;
      }

      const mid = midpoint(searchLow, searchHigh);
      const midResult = await inferenceFn(candidate.factor_id, mid, factorSignal);
      iterations++;
      probes++; // bisection midpoint probe completed

      const midWinner = getArgmaxOption(midResult);

      if (midWinner === lowSideWinner) {
        // Same winner as low side — flip is in [mid, searchHigh]
        searchLow = mid;
      } else if (midWinner === highSideWinner) {
        // Same winner as high side — flip is in [searchLow, mid]
        searchHigh = mid;
      } else {
        // Non-monotonic: a third option became the winner. Fall back to grid scan.
        return await gridFallback(
          candidate, inferenceFn, originalWinnerId, 0, 1, config, factorDeadline, iterations, probes, diag, marginSensitivity, factorSignal
        );
      }
    }

    // Check if precision was achieved
    const precisionAchieved = Math.abs(searchHigh - searchLow);
    const flipValue = roundTo4(midpoint(searchLow, searchHigh));

    diag.iterations_used = iterations;
    diag.probes_used = probes;
    diag.precision_achieved = precisionAchieved;
    diag.flip_value = flipValue;
    diag.alternative_winner_id = farWinner;

    if (precisionAchieved > config.precisionTarget) {
      diag.flip_reason = 'insufficient_precision';
      return {
        result: { ...candidate, flip_value: flipValue, flip_reason: 'insufficient_precision', iterations_used: iterations, probes_used: probes, alternative_winner_id: farWinner, margin_sensitivity: marginSensitivity },
        diagnostics: diag,
      };
    }

    diag.flip_reason = 'found';
    return {
      result: { ...candidate, flip_value: flipValue, flip_reason: 'found', iterations_used: iterations, probes_used: probes, alternative_winner_id: farWinner, margin_sensitivity: marginSensitivity },
      diagnostics: diag,
    };
  } catch (err) {
    // Cancellation (F3): an error after the deadline is a cancelled probe →
    // disclose 'timeout'; else a genuine ISL fault → 'error'. (Mirror of the
    // Step-0 rejection branch above.)
    const reason: 'timeout' | 'error' =
      (Date.now() >= factorDeadline || factorSignal.aborted) ? 'timeout' : 'error';
    diag.flip_reason = reason;
    diag.probes_used = probes;
    return {
      result: { ...candidate, flip_value: null, flip_reason: reason, iterations_used: 0, probes_used: probes, alternative_winner_id: null },
      diagnostics: diag,
    };
  }
}

// =============================================================================
// Grid Fallback (Non-Monotonic)
// =============================================================================

/**
 * Coarse grid scan fallback for non-monotonic winner landscapes.
 * Scans 11 evenly-spaced points and picks the first flip point.
 */
async function gridFallback(
  candidate: FlipThresholdInputData,
  inferenceFn: ISLInferenceFn,
  originalWinnerId: string,
  low: number,
  high: number,
  config: FlipSearchConfig,
  deadline: number,
  iterationsSoFar: number,
  probesSoFar: number,
  diag: FlipDiagnostics,
  marginSensitivity: MarginSensitivity,
  signal?: AbortSignal
): Promise<{ result: FlipThresholdInputData; diagnostics: FlipDiagnostics }> {
  // iterations_used stays bisection-only: grid probes count toward probes_used,
  // never toward iterations_used. `iterations` is fixed to the bisection-iteration
  // count at the moment we fell back to the grid scan.
  const iterations = iterationsSoFar;
  let probes = probesSoFar;
  const step = (high - low) / (config.maxGridPoints - 1);

  for (let i = 0; i < config.maxGridPoints; i++) {
    if (Date.now() >= deadline) {
      diag.iterations_used = iterations;
      diag.probes_used = probes;
      diag.flip_reason = 'timeout';
      return {
        result: { ...candidate, flip_value: null, flip_reason: 'timeout', iterations_used: iterations, probes_used: probes, alternative_winner_id: null, margin_sensitivity: marginSensitivity },
        diagnostics: diag,
      };
    }

    const probeValue = low + i * step;

    try {
      const result = await inferenceFn(candidate.factor_id, probeValue, signal);
      probes++; // grid probe completed (counts toward probes_used, not iterations_used)

      const winner = getArgmaxOption(result);
      if (winner !== originalWinnerId) {
        const flipValue = roundTo4(probeValue);
        diag.iterations_used = iterations;
        diag.probes_used = probes;
        diag.flip_reason = 'non_monotonic_grid';
        diag.flip_value = flipValue;
        diag.alternative_winner_id = winner;
        return {
          result: { ...candidate, flip_value: flipValue, flip_reason: 'non_monotonic_grid', iterations_used: iterations, probes_used: probes, alternative_winner_id: winner, margin_sensitivity: marginSensitivity },
          diagnostics: diag,
        };
      }
    } catch {
      // Skip failed points in grid scan. A failed probe did not complete, so it
      // counts toward neither probes_used nor iterations_used.
    }
  }

  // No flip found in grid
  diag.iterations_used = iterations;
  diag.probes_used = probes;
  diag.flip_reason = 'no_effect_within_bounds';
  return {
    result: { ...candidate, flip_value: null, flip_reason: 'no_effect_within_bounds', iterations_used: iterations, probes_used: probes, alternative_winner_id: null, margin_sensitivity: marginSensitivity },
    diagnostics: diag,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get the option_id with the highest win_probability (argmax).
 *
 * Deterministic tie-break: when two options share the highest win_probability,
 * the lexicographically-smaller `option_id` wins. This matches the tie-break
 * used by `topTwo()` in `./margin-sensitivity.ts` so that strict-flip
 * detection (`W0 !== W_min || W0 !== W_max`) cannot disagree with the
 * margin-sensitivity diagnostic on exact ties. Without this, ISL option-
 * array order could produce a spurious `movement: 'flipped'` classification
 * for a non-flip.
 */
function getArgmaxOption(result: FlipInferenceResult): string {
  let maxProb = -Infinity;
  let maxId = '';
  for (const opt of result.options) {
    if (
      opt.win_probability > maxProb ||
      (opt.win_probability === maxProb && maxId !== '' && opt.option_id < maxId)
    ) {
      maxProb = opt.win_probability;
      maxId = opt.option_id;
    }
  }
  return maxId;
}

/**
 * Midpoint of two values.
 */
function midpoint(a: number, b: number): number {
  return (a + b) / 2;
}

/**
 * Round to 4 decimal places.
 */
function roundTo4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// =============================================================================
// ISL Inference Function Builder
// =============================================================================

/**
 * Create an ISL inference function from the ISL service and original request.
 *
 * Constructs a closure that, per probe:
 * 1. Clones the request graph and sets the target factor's observed_state.value
 *    to the probe value — the field ISL's comparison reads as the sampling mean
 * 2. Keeps the target factor's parameter_uncertainties.mean aligned to the same
 *    value (contract honesty; the comparison shadows this field)
 * 3. Forwards the resolved analysis seed (the same seed sent to the main ISL
 *    robustness call) on every probe request
 * 4. Calls ISL via the service's callAnalysisEndpoint
 * 5. Returns the option comparison results
 *
 * Seed forwarding + intentional common random numbers: every probe in a single
 * flip search receives `originalRequest.seed` — the resolved seed PLoT sends to
 * the main analysis call (the explicit request seed, or the seed PLoT derived
 * from the canonical request/graph when omitted). Holding the seed constant
 * across probe points means ISL's PCG64 sampler draws the *same* edge
 * configurations and factor-noise z-values at every probe; only the probed
 * factor's sampling mean shifts. That preserves the deterministic
 * common-random-numbers smoothness the bisection relies on, while aligning the
 * probe world with the displayed base analysis (same seed → probe baseline
 * margin matches the main-call margin within representation/rounding limits).
 * We deliberately do NOT vary the seed per probe and do NOT fall back to ISL's
 * graph-hash seed (which ignores the request seed).
 *
 * @param callAnalysis - Function that calls ISL analysis endpoint
 * @param originalRequest - The original ISL robustness request (carries the
 *   resolved seed forwarded to the main analysis call)
 * @param requestId - Request ID for tracing (suffixed with flip search context)
 * @returns ISLInferenceFn callback
 */
export function createISLInferenceFn(
  callAnalysis: (endpoint: string, body: unknown, requestId: string, signal?: AbortSignal) => Promise<{ data: any | null }>,
  originalRequest: {
    graph: { nodes: any[]; edges: any[] };
    options: any[];
    goal_node_id: string;
    n_samples?: number;
    parameter_uncertainties?: Array<{ node_id: string; distribution: string; mean: number; std: number }>;
    // Resolved seed sent to the main ISL analysis call (explicit request seed,
    // or PLoT-derived seed when omitted). Forwarded verbatim on every probe so
    // common random numbers stay intentional and aligned with the base analysis.
    seed?: string | number;
  },
  requestId: string,
  // Track S: sample depth for flip probes, decoupled from base analysis depth.
  // When omitted, probes fall back to the base request's n_samples (legacy behaviour).
  flipProbeNSamples?: number
): ISLInferenceFn {
  return async (factorId: string, overrideMean: number, signal?: AbortSignal): Promise<FlipInferenceResult> => {
    // F3 (Codex): a probe dequeued AFTER the deadline (semaphore release path)
    // must not start real work — short-circuit before building the payload or
    // calling ISL. This is the "re-check the deadline in the acquire/release path"
    // guarantee, delivered via the threaded signal rather than by coupling the
    // generic concurrency limiter to the flip deadline. An in-flight probe is
    // separately cancelled inside the client (the signal aborts its fetch).
    if (signal?.aborted) {
      throw new DOMException('Flip probe aborted before ISL call (deadline elapsed)', 'AbortError');
    }
    // Clone parameter_uncertainties with the target factor's mean overridden
    const basePU = originalRequest.parameter_uncertainties ?? [];
    const factorExists = basePU.some((pu) => pu.node_id === factorId);

    let paramUncertainties: typeof basePU;
    if (factorExists) {
      paramUncertainties = basePU.map((pu) => {
        if (pu.node_id === factorId) {
          return { ...pu, mean: overrideMean };
        }
        return { ...pu };
      });
    } else {
      // Factor not in original parameter_uncertainties — insert with default std
      paramUncertainties = [
        ...basePU.map((pu) => ({ ...pu })),
        {
          node_id: factorId,
          distribution: 'normal' as const,
          mean: overrideMean,
          std: Math.max(0.1, Math.abs(overrideMean) * 0.15),
        },
      ];
    }

    // Clone the graph for THIS probe and set the target factor's
    // observed_state.value to the probe value. ISL's comparison samples each factor
    // from Normal(observed_state.value, parameter_uncertainties.std): the comparison
    // MEAN is read from the graph node's observed_state.value, while the request's
    // parameter_uncertainties.mean is shadowed (not consumed) by the comparison path.
    // So observed_state.value is the field that actually moves the winner; the aligned
    // parameter_uncertainties.mean override above is kept only for contract honesty /
    // possible future consumers.
    //
    // overrideMean is already in the normalised [0,1] scale of observed_state.value,
    // so the normalised scale is preserved (we never write raw human values here).
    // raw_value/cap/unit/baseline (display + denormalisation metadata) and std
    // (uncertainty width) are left untouched. The clone is probe-local: the original
    // request graph is never mutated, and concurrent Step-0 probes (baseline/0/1)
    // cannot leak values into one another.
    const probeNodes = (originalRequest.graph?.nodes ?? []).map((node) => {
      if (node?.id !== factorId) return node; // other nodes kept by reference, never mutated
      return {
        ...node,
        observed_state: {
          ...(node.observed_state ?? {}),
          value: overrideMean,
        },
      };
    });
    const probeGraph = { ...originalRequest.graph, nodes: probeNodes };

    const modifiedRequest = {
      request_id: `${requestId}__flip_${factorId}`,
      graph: probeGraph,
      options: originalRequest.options,
      goal_node_id: originalRequest.goal_node_id,
      // Track S: probes use their own depth (decoupled). Falls back to base depth
      // when no probe depth is supplied, preserving legacy behaviour for old callers.
      n_samples: flipProbeNSamples ?? originalRequest.n_samples,
      analysis_types: ['comparison'] as const,
      parameter_uncertainties: paramUncertainties,
      // Forward the resolved analysis seed on every probe (intentional CRN —
      // same seed across all probe points; never per-probe, never the
      // graph-hash fallback). Omit the key entirely when no seed is present so
      // ISL's existing graph-hash default still applies for seedless callers.
      ...(originalRequest.seed !== undefined && originalRequest.seed !== null
        ? { seed: originalRequest.seed }
        : {}),
    };

    const result = await callAnalysis(
      '/api/v1/robustness/analyze/v2',
      modifiedRequest,
      `${requestId}__flip`,
      signal
    );

    if (!result.data) {
      throw new Error(`ISL inference failed for factor ${factorId} at mean=${overrideMean}`);
    }

    // ISL returns options in 'results' or 'options'
    const options = result.data.results ?? result.data.options ?? [];
    return {
      options: options.map((opt: any) => ({
        option_id: opt.option_id ?? opt.id ?? '',
        win_probability: opt.win_probability ?? 0,
      })),
    };
  };
}
