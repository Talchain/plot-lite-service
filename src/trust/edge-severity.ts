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

/**
 * Doctrine 013 — producer-owned fragile-edge visibility floor over
 * `switch_probability`. Ratified from the UI's `THRESHOLDS.FRAGILE_EDGE_FILTER`
 * (> 0.15). DOCTRINE-PENDING (Neil): a future ruling changes this single const.
 */
export const FRAGILE_EDGE_VISIBLE_MIN = 0.15;

/**
 * Derive the producer-DISCLOSED `visible` gate for a fragile edge from its
 * `switch_probability`. This is the flag the UI's fragile-edge filter used to
 * compute locally; PLoT now discloses it (`visible = switch_probability >
 * FRAGILE_EDGE_VISIBLE_MIN`) but does NOT filter the array — the UI still
 * decides what to render.
 *
 * Returns `undefined` (field omitted by the caller) when switch_probability is
 * absent or non-finite — distinct from `false`, which is a real
 * below-threshold measurement.
 */
export function deriveFragileEdgeVisible(
  switchProbability: number | null | undefined,
): boolean | undefined {
  if (typeof switchProbability !== 'number' || !Number.isFinite(switchProbability)) {
    return undefined;
  }
  return switchProbability > FRAGILE_EDGE_VISIBLE_MIN;
}
