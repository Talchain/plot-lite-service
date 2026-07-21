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
 * This HELPER returns `undefined` (field omitted by the caller) when
 * switch_probability is absent or non-finite — distinct from `false`, which is
 * a real below-threshold measurement.
 *
 * KNOWN SEAM (rowed) — do NOT describe this field as absent-omitting
 * end-to-end. The upstream adapter (robustness-analysis.ts:65,
 * `normalizeFragileEdge`) currently defaults `switch_probability ?? 0` when ISL
 * omits it, so on the live /v2/run wire an sp-less fragile edge reaches this
 * helper as `0` and emits `visible:false` (consistent with its likewise-
 * defaulted `severity` on the same seam) — the helper's absent-omitting branch
 * is UNREACHABLE on the current wire. This is unreachable on current ISL output
 * (fragile edges always carry sp); the source `?? 0` kill is tracked
 * separately. See tests/doctrine-013-fragile-edge-visible.test.ts (the KNOWN
 * SEAM describe) for the disclosed pin.
 */
export function deriveFragileEdgeVisible(
  switchProbability: number | null | undefined,
): boolean | undefined {
  if (typeof switchProbability !== 'number' || !Number.isFinite(switchProbability)) {
    return undefined;
  }
  return switchProbability > FRAGILE_EDGE_VISIBLE_MIN;
}
