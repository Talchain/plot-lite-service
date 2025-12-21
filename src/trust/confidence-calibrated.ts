import type { ConfidenceBadge } from './types.js';

export interface CalibrationInput {
  /** Mask diversity metric (0-1), higher = more diversity in sampled graphs */
  mask_diversity: number;
  /** Path stability metric (0-1), higher = more stable causal paths */
  path_stability: number;
  /** Linearity distance (0-1), lower = closer to linear range */
  linearity_distance: number;
  /** Number of samples used */
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

/**
 * Sprint N Feature 3: Confidence Comparison
 * Compares current vs calibrated confidence formulas
 */

export type ConfidenceMethod = 'current' | 'calibrated';

export interface ConfidenceComparison {
  /** Current formula confidence result */
  current: {
    level: string;
    score: number;
  };
  /** Calibrated formula confidence result */
  calibrated: {
    level: string;
    score: number;
  };
  /** Score delta: calibrated - current (positive = calibrated is higher) */
  delta: number;
  /** Did the level change between formulas? */
  level_changed: boolean;
  /** Direction of level change if changed */
  level_direction?: 'upgrade' | 'downgrade' | 'same';
  /** Human-readable interpretation */
  interpretation: string;
}

/**
 * Level hierarchy for comparison (uppercase per UI contract)
 */
const LEVEL_ORDER: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

/**
 * Compare current and calibrated confidence evaluations
 *
 * @param current - Current confidence badge from calculateConfidence
 * @param calibrated - Calibrated confidence result from calculateCalibratedConfidence
 * @returns Comparison result showing differences between methods
 */
export function compareConfidence(
  current: ConfidenceBadge,
  calibrated: CalibrationResult
): ConfidenceComparison {
  const delta = Math.round((calibrated.score - current.score) * 100) / 100;
  const level_changed = current.level !== calibrated.level;

  let level_direction: 'upgrade' | 'downgrade' | 'same' = 'same';
  if (level_changed) {
    const currentOrder = LEVEL_ORDER[current.level] ?? 1;
    const calibratedOrder = LEVEL_ORDER[calibrated.level] ?? 1;
    level_direction = calibratedOrder > currentOrder ? 'upgrade' : 'downgrade';
  }

  const interpretation = generateComparisonInterpretation(
    current.level,
    calibrated.level,
    delta,
    level_direction
  );

  return {
    current: {
      level: current.level,
      score: current.score,
    },
    calibrated: {
      level: calibrated.level,
      score: calibrated.score,
    },
    delta,
    level_changed,
    ...(level_changed && { level_direction }),
    interpretation,
  };
}

/**
 * Generate human-readable interpretation of confidence comparison
 */
function generateComparisonInterpretation(
  currentLevel: string,
  calibratedLevel: string,
  delta: number,
  direction: 'upgrade' | 'downgrade' | 'same'
): string {
  const deltaStr = delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2);

  if (direction === 'same') {
    if (Math.abs(delta) < 0.05) {
      return `Both methods agree: ${currentLevel} confidence (delta: ${deltaStr}). Formulas are well-aligned.`;
    }
    return `Both methods: ${currentLevel} confidence, but score differs by ${deltaStr}. Consider reviewing edge weights.`;
  }

  if (direction === 'upgrade') {
    return `Calibrated formula suggests ${calibratedLevel} confidence (up from ${currentLevel}). Delta: ${deltaStr}. Model may perform better than initial estimate.`;
  }

  return `Calibrated formula suggests ${calibratedLevel} confidence (down from ${currentLevel}). Delta: ${deltaStr}. Consider strengthening evidence coverage.`;
}
