/**
 * Advanced Sampling Strategies
 *
 * Brief 8: Tasks 5 & 6 - Stratified and Importance Sampling
 *
 * Optional enhancements for better coverage and tail risk estimation.
 * Gate behind feature flags:
 * - ENABLE_STRATIFIED_SAMPLING
 * - ENABLE_IMPORTANCE_SAMPLING
 */

import { FLAGS } from '../config/flags.js';
import { XorShift128Plus } from '../scm-lite/rng.js';
import type {
  StratifiedSamplingConfig,
  ImportanceSamplingConfig,
} from './types.js';

/**
 * Importance weight for a sample
 */
interface ImportanceWeight {
  /** Sample index */
  sample_id: number;
  /** Importance weight */
  weight: number;
  /** Inverse probability (for bias correction) */
  inv_prob: number;
}

/**
 * Generate stratified parameter values
 *
 * Stratified sampling divides the parameter space into strata
 * and ensures samples from each stratum. This reduces variance
 * compared to pure Monte Carlo.
 *
 * @param config - Stratified sampling configuration
 * @param seed - Random seed for sampling within strata
 * @param totalSamples - Total number of samples to generate
 * @returns Array of parameter values, one per sample
 */
export function generateStratifiedSamples(
  config: StratifiedSamplingConfig,
  seed: number,
  totalSamples: number
): number[][] {
  if (!FLAGS.ENABLE_STRATIFIED_SAMPLING || !config.enabled) {
    return [];
  }

  const rng = new XorShift128Plus(seed);
  const nParams = config.stratify_params.length;
  const nStrata = config.n_strata;

  // Samples per stratum (rounded up)
  const samplesPerStratum = Math.ceil(totalSamples / Math.pow(nStrata, nParams));

  const result: number[][] = [];

  // Generate samples for each stratum
  // For simplicity, we use a grid of strata and sample uniformly within each
  const generateStratumSamples = (
    paramIndex: number,
    stratumIndices: number[],
    accumulator: number[]
  ) => {
    if (paramIndex >= nParams) {
      // Generate samples for this stratum
      for (let i = 0; i < samplesPerStratum && result.length < totalSamples; i++) {
        const sample = accumulator.map((stratumIdx) => {
          // Sample uniformly within the stratum
          const stratumSize = 1.0 / nStrata;
          const lower = stratumIdx * stratumSize;
          const upper = (stratumIdx + 1) * stratumSize;
          return lower + rng.next() * (upper - lower);
        });
        result.push(sample);
      }
      return;
    }

    // Recurse through strata for current parameter
    for (let s = 0; s < nStrata; s++) {
      generateStratumSamples(paramIndex + 1, [...stratumIndices, s], [...accumulator, s]);
    }
  };

  generateStratumSamples(0, [], []);

  return result.slice(0, totalSamples);
}

/**
 * Generate Latin Hypercube samples
 *
 * Latin Hypercube Sampling (LHS) is a stratified sampling technique
 * that ensures each parameter dimension is divided into n equal strata
 * and exactly one sample is drawn from each stratum in each dimension.
 *
 * @param nSamples - Number of samples
 * @param nDims - Number of dimensions (parameters)
 * @param seed - Random seed
 * @returns Array of samples, each with nDims values in [0, 1]
 */
export function generateLatinHypercubeSamples(
  nSamples: number,
  nDims: number,
  seed: number
): number[][] {
  if (!FLAGS.ENABLE_STRATIFIED_SAMPLING) {
    return [];
  }

  const rng = new XorShift128Plus(seed);
  const samples: number[][] = [];

  // Initialize with stratified samples in each dimension
  const stratified: number[][] = [];
  for (let d = 0; d < nDims; d++) {
    const dimSamples: number[] = [];
    for (let i = 0; i < nSamples; i++) {
      // Sample uniformly within stratum i
      const lower = i / nSamples;
      const upper = (i + 1) / nSamples;
      dimSamples.push(lower + rng.next() * (upper - lower));
    }
    stratified.push(dimSamples);
  }

  // Shuffle each dimension independently (Fisher-Yates)
  for (let d = 0; d < nDims; d++) {
    for (let i = nSamples - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [stratified[d][i], stratified[d][j]] = [stratified[d][j], stratified[d][i]];
    }
  }

  // Combine shuffled dimensions
  for (let i = 0; i < nSamples; i++) {
    const sample: number[] = [];
    for (let d = 0; d < nDims; d++) {
      sample.push(stratified[d][i]);
    }
    samples.push(sample);
  }

  return samples;
}

/**
 * Compute importance weights for samples
 *
 * Importance sampling over-samples from regions of interest
 * (e.g., tail regions) and corrects for the bias with weights.
 *
 * The proposal distribution is:
 * q(x) = (1 - oversample_factor) * p(x) + oversample_factor * p_tail(x)
 *
 * where p_tail(x) is a distribution concentrated on tail regions.
 *
 * @param config - Importance sampling configuration
 * @param values - Sample values for the target node
 * @returns Importance weights for each sample
 */
export function computeImportanceWeights(
  config: ImportanceSamplingConfig,
  values: number[]
): ImportanceWeight[] {
  if (!FLAGS.ENABLE_IMPORTANCE_SAMPLING || !config.enabled) {
    // Return uniform weights
    return values.map((_, i) => ({
      sample_id: i,
      weight: 1.0,
      inv_prob: 1.0,
    }));
  }

  const { threshold, oversample_factor } = config;

  // Identify tail samples
  const isTail = values.map((v) => Math.abs(v) >= threshold);

  // Compute importance weights
  // If we over-sample tails, tail samples need lower weight
  // Non-tail samples need higher weight
  const weights: ImportanceWeight[] = [];

  const nTotal = values.length;
  const nTail = isTail.filter((t) => t).length;
  const nNonTail = nTotal - nTail;

  for (let i = 0; i < values.length; i++) {
    let weight: number;
    let inv_prob: number;

    if (isTail[i]) {
      // Tail samples were over-sampled
      // Weight = p(x) / q(x) = original_prob / proposal_prob
      // For over-sampling: proposal_prob > original_prob
      weight = 1.0 / (1.0 + oversample_factor);
      inv_prob = 1.0 + oversample_factor;
    } else {
      // Non-tail samples were under-sampled
      weight = 1.0 / (1.0 - (oversample_factor * nTail) / nNonTail);
      inv_prob = 1.0 - (oversample_factor * nTail) / nNonTail;
    }

    // Clamp weights to reasonable range
    weight = Math.max(0.1, Math.min(10.0, weight));

    weights.push({
      sample_id: i,
      weight,
      inv_prob,
    });
  }

  // Normalize weights to sum to n
  const sumWeights = weights.reduce((sum, w) => sum + w.weight, 0);
  const normalizer = nTotal / sumWeights;

  return weights.map((w) => ({
    ...w,
    weight: w.weight * normalizer,
  }));
}

/**
 * Apply importance weights to compute weighted statistics
 *
 * @param values - Sample values
 * @param weights - Importance weights
 * @returns Weighted mean and standard deviation
 */
export function computeWeightedStatistics(
  values: number[],
  weights: ImportanceWeight[]
): { mean: number; std: number; effective_sample_size: number } {
  if (values.length !== weights.length) {
    throw new Error('Values and weights must have same length');
  }

  const n = values.length;

  // Weighted mean
  let sumWeightedValues = 0;
  let sumWeights = 0;

  for (let i = 0; i < n; i++) {
    sumWeightedValues += weights[i].weight * values[i];
    sumWeights += weights[i].weight;
  }

  const mean = sumWeightedValues / sumWeights;

  // Weighted variance
  let sumWeightedSqDiff = 0;
  let sumSqWeights = 0;

  for (let i = 0; i < n; i++) {
    const diff = values[i] - mean;
    sumWeightedSqDiff += weights[i].weight * diff * diff;
    sumSqWeights += weights[i].weight * weights[i].weight;
  }

  // Bessel's correction for weighted variance
  const variance = sumWeightedSqDiff / (sumWeights - sumSqWeights / sumWeights);
  const std = Math.sqrt(Math.max(0, variance));

  // Effective sample size (Kish's approximation)
  const effective_sample_size = (sumWeights * sumWeights) / sumSqWeights;

  return { mean, std, effective_sample_size };
}

/**
 * Generate tail-focused samples for importance sampling
 *
 * Generates additional samples in tail regions to improve
 * tail risk estimation.
 *
 * @param config - Importance sampling configuration
 * @param baseSamples - Original samples
 * @param seed - Random seed
 * @returns Additional tail samples
 */
export function generateTailSamples(
  config: ImportanceSamplingConfig,
  baseSamples: number[],
  seed: number
): { values: number[]; indices: number[] } {
  if (!FLAGS.ENABLE_IMPORTANCE_SAMPLING || !config.enabled) {
    return { values: [], indices: [] };
  }

  const { threshold, oversample_factor } = config;
  const rng = new XorShift128Plus(seed);

  // Find tail samples
  const tailIndices: number[] = [];
  for (let i = 0; i < baseSamples.length; i++) {
    if (Math.abs(baseSamples[i]) >= threshold) {
      tailIndices.push(i);
    }
  }

  // Calculate how many additional samples to generate
  const nAdditional = Math.floor(tailIndices.length * oversample_factor);

  // Resample from tail indices
  const additionalIndices: number[] = [];
  const additionalValues: number[] = [];

  for (let i = 0; i < nAdditional; i++) {
    const idx = tailIndices[Math.floor(rng.next() * tailIndices.length)];
    additionalIndices.push(idx);
    additionalValues.push(baseSamples[idx]);
  }

  return {
    values: additionalValues,
    indices: additionalIndices,
  };
}

/**
 * Check if stratified sampling is available
 */
export function isStratifiedSamplingAvailable(): boolean {
  return FLAGS.ENABLE_STRATIFIED_SAMPLING;
}

/**
 * Check if importance sampling is available
 */
export function isImportanceSamplingAvailable(): boolean {
  return FLAGS.ENABLE_IMPORTANCE_SAMPLING;
}
