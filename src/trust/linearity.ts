/**
 * Linearity & Threshold Detection
 * Warns when outside ±20% local linear range
 */

import type { LinearityWarning, ThresholdCrossing, ForkSuggestion } from './types.js';

export interface LinearityInputs {
  baseline_value: number;
  current_value: number;
  linear_range_percent?: number; // default 20
}

/**
 * Check if current value is within linear range of baseline
 */
export function checkLinearity(inputs: LinearityInputs): LinearityWarning {
  const { baseline_value, current_value, linear_range_percent = 20 } = inputs;

  const delta = current_value - baseline_value;
  const percent_change = baseline_value !== 0
    ? Math.abs((delta / baseline_value) * 100)
    : Math.abs(delta * 100);

  const outside_range = percent_change > linear_range_percent;
  const distance_from_center = percent_change;

  let recommendation = '';
  if (outside_range) {
    recommendation = `Value changed by ${percent_change.toFixed(1)}%, outside linear range (±${linear_range_percent}%). Consider forking scenarios.`;
  } else {
    recommendation = `Within linear range (±${linear_range_percent}%)`;
  }

  return {
    outside_range,
    distance_from_center,
    recommendation,
  };
}

export interface ThresholdInputs {
  metric_name: string;
  from_value: number;
  to_value: number;
  thresholds: number[]; // e.g., [99, 199] for price bands
}

/**
 * Detect threshold crossings (e.g., £99/£199 price bands)
 */
export function detectThresholdCrossings(inputs: ThresholdInputs): ThresholdCrossing[] {
  const { metric_name, from_value, to_value, thresholds } = inputs;

  const crossings: ThresholdCrossing[] = [];

  for (const threshold of thresholds) {
    const crossed =
      (from_value < threshold && to_value >= threshold) ||
      (from_value >= threshold && to_value < threshold);

    if (crossed) {
      crossings.push({
        metric: metric_name,
        from_value,
        to_value,
        threshold,
        crossed: true,
        direction: to_value > from_value ? 'up' : 'down',
      });
    }
  }

  return crossings;
}

export interface ForkInputs {
  metric_name: string;
  current_value: number;
  threshold: number;
  direction: 'up' | 'down';
}

/**
 * Generate fork suggestions for threshold crossings
 */
export function generateForkSuggestions(inputs: ForkInputs): ForkSuggestion {
  const { metric_name, current_value, threshold, direction: _direction } = inputs;

  const below_threshold = current_value < threshold;
  const above_threshold = current_value >= threshold;

  return {
    reason: `${metric_name} crosses £${threshold} threshold`,
    scenarios: [
      {
        name: 'Below Threshold',
        key_change: `${metric_name} = £${threshold - 10}`,
        outcome_headline: below_threshold
          ? 'Current outcome (no crossing)'
          : 'Lower price band - higher volume expected',
      },
      {
        name: 'Above Threshold',
        key_change: `${metric_name} = £${threshold + 10}`,
        outcome_headline: above_threshold
          ? 'Current outcome (crossed threshold)'
          : 'Higher price band - premium positioning',
      },
    ],
  };
}
