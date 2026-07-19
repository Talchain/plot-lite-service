/**
 * Neutral numeric predicates — the single source of truth for the
 * `typeof === 'number' && Number.isFinite` family used across PLoT's boundary
 * guards.
 *
 * Lives in `src/util` (a leaf) so both `routes/v2` (numeric-egress guards,
 * enrichment-egress guard) and `integrations/isl` (compute-admission) can
 * import from ONE place. A shared home in either of those dirs would force an
 * `integrations/isl → routes/v2` (or the reverse) layering inversion; the
 * neutral util avoids it.
 *
 * Two flavours, deliberately distinct:
 *  - type-guard predicates (`isFiniteNumber` / `isNonNegInt`) narrow `unknown`
 *    to `number` for boolean checks;
 *  - egress accessors (`finiteNum` / `nonNegInt`) return the value verbatim
 *    when valid else `undefined`, so a serialisation boundary can OMIT a field
 *    (honest absence) rather than emit a fabricated `null`.
 * Neither clamps nor coerces — a valid value passes through byte-identically.
 */

/** True iff `v` is a finite real number (not NaN / ±Infinity). */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** True iff `v` is a non-negative integer. */
export function isNonNegInt(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/**
 * Finite real number (any magnitude), else `undefined`. Use for measurements:
 * means, std, deltas, band endpoints.
 */
export function finiteNum(v: unknown): number | undefined {
  return isFiniteNumber(v) ? v : undefined;
}

/**
 * Non-negative integer, else `undefined`. Use for sample counts (n_samples,
 * n_valid_samples, n_seeds).
 */
export function nonNegInt(v: unknown): number | undefined {
  return isNonNegInt(v) ? v : undefined;
}

/**
 * True iff `o` is a non-null object whose every field named in `keys` is a
 * finite number. The shared shape behind compute-admission's weights/caps
 * validation — one predicate over an explicit field list.
 */
export function allFiniteNumberFields(o: unknown, keys: readonly string[]): boolean {
  if (!o || typeof o !== 'object') return false;
  const rec = o as Record<string, unknown>;
  return keys.every((k) => isFiniteNumber(rec[k]));
}
