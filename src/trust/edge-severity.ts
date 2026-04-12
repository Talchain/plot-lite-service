/**
 * Fragile edge severity classification (B1).
 * Thresholds ported from UI useResultsSectionData.ts unchanged.
 */

export type EdgeSeverity = 'critical' | 'error' | 'warning';

/**
 * Classify fragile edge severity from switch_probability.
 * - switch_probability > 0.7 → 'critical'
 * - switch_probability > 0.5 → 'error'
 * - switch_probability ≤ 0.5 → 'warning'
 */
export function classifyEdgeSeverity(switchProbability: number): EdgeSeverity {
  if (switchProbability > 0.7) return 'critical';
  if (switchProbability > 0.5) return 'error';
  return 'warning';
}
