/**
 * Fragile edge severity classification (B1).
 * Thresholds ported from UI useResultsSectionData.ts unchanged.
 */

import { isFiniteNumber } from '../util/numeric.js';

export type EdgeSeverity = 'critical' | 'error' | 'warning';

/**
 * Classify fragile edge severity from switch_probability.
 * - switch_probability > 0.7 → 'critical'
 * - switch_probability > 0.5 → 'error'
 * - 0 ≤ switch_probability ≤ 0.5 → 'warning'
 *
 * Returns `undefined` (field omitted by the caller) when switch_probability is
 * absent or non-finite — distinct from 'warning', which is a real low-but-present
 * measurement. Mirrors `deriveFragileEdgeVisible`'s absent-handling so an sp-less
 * fragile edge emits NEITHER severity NOR visible (honesty: absent ≠ 'warning').
 */
export function classifyEdgeSeverity(
  switchProbability: number | null | undefined,
): EdgeSeverity | undefined {
  if (!isFiniteNumber(switchProbability)) {
    return undefined;
  }
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
 * This HELPER returns `undefined` (field omitted by the caller) when
 * switch_probability is absent or non-finite — distinct from `false`, which is
 * a real below-threshold measurement.
 *
 * Absent-omitting is now end-to-end. The upstream adapter
 * (robustness-analysis.ts, `normalizeFragileEdge` + the legacy-string branch)
 * no longer defaults `switch_probability ?? 0` when ISL omits it, so an sp-less
 * fragile edge reaches this helper as `undefined` and emits NO `visible` (and,
 * via `classifyEdgeSeverity`, no `severity`) on the /v2/run wire. Unreachable on
 * current ISL output (fragile edges always carry sp) ⇒ zero golden delta. See
 * tests/doctrine-013-fragile-edge-visible.test.ts (the "SOURCE FIX (closed
 * seam)" describe) for the end-to-end pin.
 */
export function deriveFragileEdgeVisible(
  switchProbability: number | null | undefined,
): boolean | undefined {
  if (!isFiniteNumber(switchProbability)) {
    return undefined;
  }
  return switchProbability > FRAGILE_EDGE_VISIBLE_MIN;
}
