/**
 * Flip Threshold Binary Search
 *
 * Resolves exact flip_value for candidate flip thresholds by running binary
 * search over ISL inference. A "flip" = the argmax option changes (the winner
 * is no longer the highest win_probability option).
 *
 * ## Algorithm per factor:
 * 0. Bracket check — evaluate both endpoints; skip if no flip
 * 1. Binary search — bisect [low, high], call ISL at midpoint
 * 2. Non-monotonicity guard — if winner oscillates, fall back to grid scan
 * 3. Converge when high - low <= 0.01
 *
 * @see Task 2: Flip threshold computation — binary search over ISL inference
 */

import type { FlipThresholdInputData } from '../cee/validation/m1-review-types.js';

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
  /** Max binary search iterations per factor (default: 10) */
  maxIterations: number;
  /** Convergence threshold for binary search (default: 0.01) */
  convergenceThreshold: number;
  /** Number of grid points for non-monotonic fallback (default: 11) */
  maxGridPoints: number;
  /** Per-factor timeout in ms (default: 5000) */
  perFactorTimeoutMs: number;
  /** Overall timeout in ms (default: 10000) */
  overallTimeoutMs: number;
}

function getDefaultConfig(): FlipSearchConfig {
  return {
    maxIterations: 10,
    convergenceThreshold: 0.01,
    maxGridPoints: 11,
    perFactorTimeoutMs: parseInt(process.env.FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS ?? '5000', 10),
    overallTimeoutMs: parseInt(process.env.FLIP_SEARCH_OVERALL_TIMEOUT_MS ?? '10000', 10),
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
): Promise<FlipThresholdInputData[]> {
  const cfg = { ...getDefaultConfig(), ...config };

  if (candidates.length === 0) {
    return [];
  }

  const overallDeadline = Date.now() + cfg.overallTimeoutMs;

  // Process factors with max 2 concurrency (spec: max 2 parallel ISL calls)
  const results = await Promise.all(
    candidates.map((candidate) =>
      searchFlipForFactor(candidate, inferenceFn, originalWinnerId, cfg, overallDeadline)
    )
  );

  return results;
}

// =============================================================================
// Per-Factor Search
// =============================================================================

/**
 * Search for the flip point of a single factor.
 */
async function searchFlipForFactor(
  candidate: FlipThresholdInputData,
  inferenceFn: ISLInferenceFn,
  originalWinnerId: string,
  config: FlipSearchConfig,
  overallDeadline: number
): Promise<FlipThresholdInputData> {
  const factorDeadline = Math.min(Date.now() + config.perFactorTimeoutMs, overallDeadline);

  // Determine search range in [0, 1] normalised space
  const currentValue = candidate.current_value;

  // Guard: skip binary search if current_value is outside normalised [0, 1] range
  if (currentValue < 0 || currentValue > 1) {
    return {
      ...candidate,
      flip_value: null,
      flip_reason: 'heuristic',
      iterations_used: 0,
    };
  }

  // Search direction: 'decrease' means search [0, currentValue], 'increase' means [currentValue, 1]
  let low: number;
  let high: number;
  if (candidate.direction === 'decrease') {
    low = 0.0;
    high = currentValue;
  } else {
    low = currentValue;
    high = 1.0;
  }

  // Edge case: factor at boundary in flip direction
  if (Math.abs(high - low) < config.convergenceThreshold) {
    return {
      ...candidate,
      flip_value: null,
      flip_reason: 'boundary',
      iterations_used: 0,
    };
  }

  let iterations = 0;

  try {
    // Step 0: Bracket check — evaluate both endpoints
    if (Date.now() >= factorDeadline) {
      return { ...candidate, flip_value: null, flip_reason: 'timeout', iterations_used: 0 };
    }

    const [lowResult, highResult] = await Promise.all([
      inferenceFn(candidate.factor_id, low),
      inferenceFn(candidate.factor_id, high),
    ]);
    iterations += 2;

    const lowWinner = getArgmaxOption(lowResult);
    const highWinner = getArgmaxOption(highResult);

    // If winner is the same at both endpoints → no flip exists in this range
    if (lowWinner === highWinner) {
      return {
        ...candidate,
        flip_value: null,
        flip_reason: 'no_bracket',
        iterations_used: iterations,
      };
    }

    // Step 1: Binary search
    // We know low endpoint has one winner, high endpoint has another
    // Find the crossover point
    let searchLow = low;
    let searchHigh = high;
    // Track the winner at searchLow (we bisect toward the flip)
    let lowSideWinner = lowWinner;

    for (let i = 0; i < config.maxIterations; i++) {
      if (Date.now() >= factorDeadline) {
        return {
          ...candidate,
          flip_value: roundTo4(midpoint(searchLow, searchHigh)),
          flip_reason: 'timeout',
          iterations_used: iterations,
        };
      }

      if (searchHigh - searchLow <= config.convergenceThreshold) {
        break;
      }

      const mid = midpoint(searchLow, searchHigh);
      const midResult = await inferenceFn(candidate.factor_id, mid);
      iterations++;

      const midWinner = getArgmaxOption(midResult);

      if (midWinner === lowSideWinner) {
        // Flip is in [mid, searchHigh]
        searchLow = mid;
        // lowSideWinner stays the same
      } else {
        // Check for non-monotonicity: midWinner should match highWinner
        // if the function is monotonic
        if (midWinner !== highWinner && midWinner !== lowSideWinner) {
          // Non-monotonic: a third option became the winner
          // Fall back to grid scan
          return await gridFallback(
            candidate, inferenceFn, originalWinnerId, low, high, config, factorDeadline, iterations
          );
        }

        // Winner changed at midpoint — flip is in [searchLow, mid]
        searchHigh = mid;
        // Update highWinner tracking — it's now midWinner
        // Note: lowSideWinner stays the same
      }
    }

    // Converged — return midpoint of final interval
    const flipValue = roundTo4(midpoint(searchLow, searchHigh));
    return {
      ...candidate,
      flip_value: flipValue,
      flip_reason: 'found',
      iterations_used: iterations,
    };
  } catch (err) {
    // ISL call failed
    return {
      ...candidate,
      flip_value: null,
      flip_reason: 'isl_error',
      iterations_used: iterations,
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
  iterationsSoFar: number
): Promise<FlipThresholdInputData> {
  let iterations = iterationsSoFar;
  const step = (high - low) / (config.maxGridPoints - 1);

  for (let i = 0; i < config.maxGridPoints; i++) {
    if (Date.now() >= deadline) {
      return {
        ...candidate,
        flip_value: null,
        flip_reason: 'timeout',
        iterations_used: iterations,
      };
    }

    const probeValue = low + i * step;

    try {
      const result = await inferenceFn(candidate.factor_id, probeValue);
      iterations++;

      const winner = getArgmaxOption(result);
      if (winner !== originalWinnerId) {
        // Found flip point
        return {
          ...candidate,
          flip_value: roundTo4(probeValue),
          flip_reason: 'non_monotonic_grid',
          iterations_used: iterations,
        };
      }
    } catch {
      // Skip failed points in grid scan
      iterations++;
    }
  }

  // No flip found in grid
  return {
    ...candidate,
    flip_value: null,
    flip_reason: 'no_bracket',
    iterations_used: iterations,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get the option_id with the highest win_probability (argmax).
 */
function getArgmaxOption(result: FlipInferenceResult): string {
  let maxProb = -Infinity;
  let maxId = '';
  for (const opt of result.options) {
    if (opt.win_probability > maxProb) {
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
