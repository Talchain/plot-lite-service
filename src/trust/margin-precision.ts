/**
 * margin_precision derivation (Codex F1 (b)+(c) + F2a).
 *
 * Extracted verbatim (R4) from the per-option constraint_margins builder in
 * routes/v2/run.ts. Pure truth table over
 * {operator, interventionClamp, thresholdClamp, diagnosed} with a 3-level
 * precedence. Returns the `margin_precision` value the caller sets on a
 * ConstraintMargin entry, or `undefined` when no honest claim can be made — in
 * which case the caller OMITS the field (absent ≠ a value).
 */

export interface MarginPrecisionInputs {
  /**
   * The constraint operator. Types as `string` because the value flows in from
   * `ISLConstraintResult.operator` (a raw `string`); only the recognized
   * literals `'<='` and `'>='` drive a claim — any other value yields no
   * understatement/overstatement, exactly as the original inline `=== '<='` /
   * `=== '>='` comparisons did.
   */
  operator: string;
  /**
   * Per-option INTERVENTION clamp direction for the target factor, if the
   * factor's sample was clamped ('low'/'high'); `undefined` when unclamped.
   */
  interventionClamp: 'low' | 'high' | undefined;
  /**
   * Constraint THRESHOLD clamp direction (the threshold pushed outside the
   * shared normalisation range), if clamped; `undefined` when unclamped.
   */
  thresholdClamp: 'low' | 'high' | undefined;
  /**
   * Whether the target factor is diagnosed. When false the clamp state is
   * unknown (e.g. a non-intervened target) and no `'exact'` claim is made.
   */
  diagnosed: boolean;
}

/**
 * Consult BOTH recorded clamp states — the per-option INTERVENTION clamp (a
 * clamped sample) and the constraint THRESHOLD clamp (a threshold pushed
 * outside the shared range) — and only claim what the evidence supports.
 *
 * Case analysis (why each clamp/operator pairing is understatement
 * vs overstatement of the emitted breach margin):
 *   INTERVENTION clamp (the SAMPLE moves):
 *     - high-clamp ('<='): true sample ≥ emitted ⇒ true breach ≥
 *       emitted ⇒ understates → lower_bound.
 *     - low-clamp  ('>='): true sample ≤ emitted ⇒ understates.
 *     - the two opposite pairings could OVERSTATE ⇒ no claim.
 *   THRESHOLD clamp (the THRESHOLD moves — the MIRROR direction):
 *     - '<=' threshold clamped LOW (to the floor, normalised 0): the
 *       true threshold is below 0, so the true breach (sample −
 *       threshold) is LARGER ⇒ emitted understates → lower_bound.
 *     - '>=' threshold clamped HIGH (to the ceiling, normalised 1):
 *       true threshold above 1, true breach (threshold − sample)
 *       LARGER ⇒ understates → lower_bound.
 *     - '<=' clamped HIGH / '>=' clamped LOW: the emitted breach
 *       could OVERSTATE the true breach ⇒ NEVER claim a bound.
 * Precedence: ANY possible overstatement ⇒ OMIT (cannot prove a
 * lower bound, and it is not exact). Otherwise ANY understatement ⇒
 * 'lower_bound'. Otherwise (no clamp on either side) 'exact' — but
 * ONLY when the target factor is diagnosed (else clamp state is
 * unknown, e.g. a non-intervened target, and no claim is made).
 */
export function deriveMarginPrecision({
  operator,
  interventionClamp,
  thresholdClamp,
  diagnosed,
}: MarginPrecisionInputs): 'exact' | 'lower_bound' | undefined {
  const interventionUnderstates =
    (interventionClamp === 'high' && operator === '<=') ||
    (interventionClamp === 'low' && operator === '>=');
  const interventionOverstates =
    interventionClamp !== undefined && !interventionUnderstates;

  const thresholdUnderstates =
    (thresholdClamp === 'low' && operator === '<=') ||
    (thresholdClamp === 'high' && operator === '>=');
  const thresholdOverstates =
    thresholdClamp !== undefined && !thresholdUnderstates;

  if (interventionOverstates || thresholdOverstates) {
    // At least one clamp may inflate the emitted margin above the true
    // breach ⇒ we cannot honestly claim 'lower_bound', and it is not
    // 'exact'. OMIT.
    return undefined;
  }
  if (interventionUnderstates || thresholdUnderstates) {
    return 'lower_bound';
  }
  if (diagnosed) {
    // Neither side clamped in any direction and the target factor is
    // diagnosed (thresholdClamp is necessarily undefined here) ⇒ exact.
    return 'exact';
  }
  return undefined;
}
