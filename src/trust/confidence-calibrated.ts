/**
 * Confidence Calibration - Deterministic thresholds for LOW/MEDIUM/HIGH
 * Uses fixed thresholds instead of weighted scoring for predictable badge assignment
 */

import type { ConfidenceBadge, ConfidenceLevel, Graph } from './types.js';

export interface CalibratedConfidenceInputs {
  graph: Graph;
  mask_diversity: number;      // 0-1: unique graphs / K
  path_stability: number;       // 0-1: sign consistency to outcome
  linearity_distance: number;   // 0-1: distance from linear (0 = perfectly linear)
  k_samples?: number;
}

/**
 * Deterministic confidence calibration with fixed thresholds
 * 
 * Rules:
 * - HIGH: diversity ≥ 0.6 AND path_stability ≥ 0.8 AND linearity_distance ≤ 0.2
 * - MEDIUM: diversity ≥ 0.3 AND path_stability ≥ 0.5
 * - else LOW
 */
export function calculateCalibratedConfidence(inputs: CalibratedConfidenceInputs): ConfidenceBadge {
  const {
    graph,
    mask_diversity,
    path_stability,
    linearity_distance,
    k_samples = 500,
  } = inputs;

  // Normalize factors to 0-1 range
  const diversity = Math.max(0, Math.min(1, mask_diversity));
  const stability = Math.max(0, Math.min(1, path_stability));
  const linearity = Math.max(0, Math.min(1, linearity_distance));

  let level: ConfidenceLevel;
  let reason: string;

  // HIGH threshold: all three conditions must be met
  if (diversity >= 0.6 && stability >= 0.8 && linearity <= 0.2) {
    level = 'HIGH';
    reason = `High diversity (${(diversity * 100).toFixed(0)}%), stable paths (${(stability * 100).toFixed(0)}%), linear behavior`;
  }
  // MEDIUM threshold: relaxed conditions
  else if (diversity >= 0.3 && stability >= 0.5) {
    level = 'MEDIUM';
    const issues: string[] = [];
    if (diversity < 0.6) issues.push(`moderate diversity (${(diversity * 100).toFixed(0)}%)`);
    if (stability < 0.8) issues.push(`acceptable stability (${(stability * 100).toFixed(0)}%)`);
    if (linearity > 0.2) issues.push(`some non-linearity (${(linearity * 100).toFixed(0)}%)`);
    reason = issues.length > 0 ? issues.join(', ') : 'Acceptable confidence factors';
  }
  // LOW: below thresholds
  else {
    level = 'LOW';
    const blockers: string[] = [];
    if (diversity < 0.3) blockers.push(`low diversity (${(diversity * 100).toFixed(0)}%)`);
    if (stability < 0.5) blockers.push(`unstable paths (${(stability * 100).toFixed(0)}%)`);
    if (blockers.length === 0) blockers.push('insufficient evidence');
    reason = `Low confidence: ${blockers.join(', ')}`;
  }

  // Invariant: level must be UPPERCASE only
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(level)) {
    throw new Error(`Invalid confidence.level: ${level}`);
  }

  return {
    level,
    reason,
    score: calculateOverallScore(diversity, stability, linearity),
    factors: {
      identifiability: stability,  // Map path_stability to identifiability
      linearity_distance: linearity,
      k_coverage: k_samples >= 1000 ? 1.0 : k_samples >= 500 ? 0.7 : 0.3,
      calibration: diversity,  // Map mask_diversity to calibration
    },
  };
}

/**
 * Calculate overall score for backward compatibility
 * Not used for badge assignment, but included for monitoring
 */
function calculateOverallScore(diversity: number, stability: number, linearity: number): number {
  // Weighted average: diversity 40%, stability 40%, linearity 20%
  const score = diversity * 0.4 + stability * 0.4 + (1 - linearity) * 0.2;
  return Math.round(score * 100) / 100;
}

/**
 * Helper to compute mask diversity from samples
 * diversity = unique_masks / total_samples
 */
export function computeMaskDiversity(masks: string[], total: number): number {
  if (total === 0) return 0;
  const unique = new Set(masks).size;
  return unique / total;
}

/**
 * Helper to compute path stability
 * stability = consistent_signs / total_paths
 */
export function computePathStability(pathSigns: number[]): number {
  if (pathSigns.length === 0) return 0;
  const positive = pathSigns.filter(s => s > 0).length;
  const negative = pathSigns.filter(s => s < 0).length;
  const dominant = Math.max(positive, negative);
  return dominant / pathSigns.length;
}

/**
 * Helper to compute linearity distance
 * distance = mean_absolute_deviation_from_linear / max_possible_deviation
 */
export function computeLinearityDistance(deviations: number[]): number {
  if (deviations.length === 0) return 0;
  const meanDeviation = deviations.reduce((sum, d) => sum + Math.abs(d), 0) / deviations.length;
  // Normalize to 0-1 (assume max deviation is 1.0)
  return Math.min(1, meanDeviation);
}
