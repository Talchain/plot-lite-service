import type { Graph } from './types.js';

export interface CalibrationInput {
  graph: Graph;
  mask_diversity: number;
  path_stability: number;
  linearity_distance: number;
  k_samples?: number;
}

export interface CalibrationResult {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  score: number;
  factors: {
    calibration: number;
    identifiability: number;
    linearity_distance: number;
    k_coverage?: number;
  };
}

export function calculateCalibratedConfidence(input: CalibrationInput): CalibrationResult {
  const calibration = Math.max(0, Math.min(1, input.mask_diversity));
  const identifiability = Math.max(0, Math.min(1, input.path_stability));
  const linearity = input.linearity_distance;

  // Determine level by thresholds
  let level: 'HIGH' | 'MEDIUM' | 'LOW';
  if (calibration >= 0.6 && identifiability >= 0.8 && linearity <= 0.2) {
    level = 'HIGH';
  } else if (calibration >= 0.3 && identifiability >= 0.5) {
    level = 'MEDIUM';
  } else {
    level = 'LOW';
  }

  const factors: CalibrationResult['factors'] = {
    calibration,
    identifiability,
    linearity_distance: linearity,
  };

  if (input.k_samples !== undefined && input.k_samples >= 1000) {
    factors.k_coverage = 1.0;
  }

  const score = (calibration + identifiability) / 2;

  return { level, score, factors };
}
