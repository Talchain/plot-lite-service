/**
 * Calibrated Confidence - deterministic thresholds
 * Flag: CONFIDENCE_CALIBRATED=1
 */
import type { ConfidenceBadge, ConfidenceLevel } from './types.js';

export interface CalibratedInputs {
  calibration: number;
  identifiability: number;
  linearity_distance: number;
}

export function calculateCalibratedConfidence(inputs: CalibratedInputs): ConfidenceBadge {
  const { calibration, identifiability, linearity_distance } = inputs;

  // Deterministic thresholds
  let level: ConfidenceLevel;
  let reason: string;

  if (calibration >= 0.6 && identifiability >= 0.8 && linearity_distance <= 0.2) {
    level = 'HIGH';
    reason = `High calibration (${calibration.toFixed(2)}), strong identifiability (${identifiability.toFixed(2)}), linear (${linearity_distance.toFixed(2)})`;
  } else if (calibration >= 0.3 && identifiability >= 0.5) {
    level = 'MEDIUM';
    reason = `Acceptable calibration (${calibration.toFixed(2)}), moderate identifiability (${identifiability.toFixed(2)})`;
  } else {
    level = 'LOW';
    reason = `Low calibration (${calibration.toFixed(2)}) or weak identifiability (${identifiability.toFixed(2)})`;
  }

  const score = (calibration * 0.4 + identifiability * 0.4 + (1 - linearity_distance) * 0.2);

  return {
    level,
    reason,
    score: Math.round(score * 100) / 100,
    factors: {
      identifiability,
      linearity_distance,
      k_coverage: 1.0,
      calibration,
    },
  };
}
