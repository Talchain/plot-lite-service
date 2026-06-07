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
 * Callback that runs ISL inference with a single factor's mean overridden.
 * The caller constructs this closure to encapsulate ISL client + request details.
 *
 * @param factorId - Factor node ID to override
 * @param overrideMean - New mean value for the factor in parameter_uncertainties
 * @returns ISL inference result with option win_probabilities
 */
export type ISLInferenceFn = (
  factorId: string,
  overrideMean: number
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

function getDefaultConfig(): FlipSearchConfig {
  const precisionTarget = 0.01;
  return {
    maxIterations: Math.ceil(Math.log2(1 / precisionTarget)),  // ~7 for [0,1]
    precisionTarget,
    maxGridPoints: 11,
    perFactorTimeoutMs: parseInt(process.env.FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS ?? '5000', 10),
    overallTimeoutMs: parseInt(process.env.FLIP_SEARCH_OVERALL_TIMEOUT_MS ?? '10000', 10),
  };
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

  // Process factors with max 2 concurrency (spec: max 2 parallel ISL calls)
  const settled = await Promise.all(
    candidates.map((candidate) =>
      searchFlipForFactor(candidate, inferenceFn, originalWinnerId, cfg, overallDeadline)
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
  overallDeadline: number
): Promise<{ result: FlipThresholdInputData; diagnostics: FlipDiagnostics }> {
  const factorDeadline = Math.min(Date.now() + config.perFactorTimeoutMs, overallDeadline);

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
      inferenceFn(candidate.factor_id, baseline),
      inferenceFn(candidate.factor_id, 0),
      inferenceFn(candidate.factor_id, 1),
    ]);
    probes += settled.filter((s) => s.status === 'fulfilled').length;

    // Any Step-0 probe failing → error, with the honest count of probes that did
    // complete. (margin_sensitivity is intentionally omitted, as on the catch path.)
    if (settled.some((s) => s.status === 'rejected')) {
      diag.flip_reason = 'error';
      diag.probes_used = probes;
      return {
        result: { ...candidate, flip_value: null, flip_reason: 'error', iterations_used: 0, probes_used: probes, alternative_winner_id: null },
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
        const flipValue = roundTo4(midpoint(searchLow, searchHigh));
        diag.iterations_used = iterations;
        diag.probes_used = probes;
        diag.precision_achieved = Math.abs(searchHigh - searchLow);
        diag.flip_reason = 'timeout';
        diag.flip_value = flipValue;
        diag.alternative_winner_id = farWinner;
        return {
          result: { ...candidate, flip_value: flipValue, flip_reason: 'timeout', iterations_used: iterations, probes_used: probes, alternative_winner_id: farWinner, margin_sensitivity: marginSensitivity },
          diagnostics: diag,
        };
      }

      if (Math.abs(searchHigh - searchLow) <= config.precisionTarget) {
        break;
      }

      const mid = midpoint(searchLow, searchHigh);
      const midResult = await inferenceFn(candidate.factor_id, mid);
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
          candidate, inferenceFn, originalWinnerId, 0, 1, config, factorDeadline, iterations, probes, diag, marginSensitivity
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
    diag.flip_reason = 'error';
    diag.probes_used = probes;
    return {
      result: { ...candidate, flip_value: null, flip_reason: 'error', iterations_used: 0, probes_used: probes, alternative_winner_id: null },
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
  marginSensitivity: MarginSensitivity
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
      const result = await inferenceFn(candidate.factor_id, probeValue);
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
 * Constructs a closure that:
 * 1. Clones the original ISL request
 * 2. Overrides the target factor's mean in parameter_uncertainties
 * 3. Calls ISL via the service's callAnalysisEndpoint
 * 4. Returns the option comparison results
 *
 * @param callAnalysis - Function that calls ISL analysis endpoint
 * @param originalRequest - The original ISL robustness request
 * @param requestId - Request ID for tracing (suffixed with flip search context)
 * @returns ISLInferenceFn callback
 */
export function createISLInferenceFn(
  callAnalysis: (endpoint: string, body: unknown, requestId: string) => Promise<{ data: any | null }>,
  originalRequest: {
    graph: { nodes: any[]; edges: any[] };
    options: any[];
    goal_node_id: string;
    n_samples?: number;
    parameter_uncertainties?: Array<{ node_id: string; distribution: string; mean: number; std: number }>;
  },
  requestId: string
): ISLInferenceFn {
  return async (factorId: string, overrideMean: number): Promise<FlipInferenceResult> => {
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

    const modifiedRequest = {
      request_id: `${requestId}__flip_${factorId}`,
      graph: originalRequest.graph,
      options: originalRequest.options,
      goal_node_id: originalRequest.goal_node_id,
      n_samples: originalRequest.n_samples,
      analysis_types: ['comparison'] as const,
      parameter_uncertainties: paramUncertainties,
    };

    const result = await callAnalysis(
      '/api/v1/robustness/analyze/v2',
      modifiedRequest,
      `${requestId}__flip`
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
