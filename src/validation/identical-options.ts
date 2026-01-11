/**
 * Identical Options Detection
 *
 * Detects when two or more options have identical intervention sets
 * after canonical normalization. Identical options are a validation error
 * because they would produce the same analysis results.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type { OptionV3, InterventionValueV3 } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * Epsilon for floating-point comparison.
 * Values within this tolerance are considered equal.
 */
const EPSILON = 1e-9;

// -----------------------------------------------------------------------------
// Canonical Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize an intervention value for canonical comparison.
 *
 * Rounds to avoid floating-point comparison issues.
 *
 * @param value Intervention value
 * @returns Rounded value
 */
function normaliseValue(value: number): number {
  return Math.round(value / EPSILON) * EPSILON;
}

/**
 * Create a canonical string representation of interventions.
 *
 * The canonical form:
 * 1. Extracts node_id → value pairs
 * 2. Sorts by node_id for deterministic ordering
 * 3. Rounds values to avoid floating-point issues
 * 4. Joins into a deterministic string
 *
 * @param interventions Intervention map
 * @returns Canonical string representation
 */
export function canonicaliseInterventions(
  interventions: Record<string, InterventionValueV3 | number>
): string {
  // Extract node_id → value pairs
  // Supports both flat format { factor_id: 59 } and nested { factor_id: { value: 59 } }
  const pairs: Array<[string, number]> = [];

  for (const [nodeId, rawIntervention] of Object.entries(interventions)) {
    // Handle flat format (number), nested format ({ value }), and invalid (null/undefined)
    let value: number;
    if (typeof rawIntervention === 'number') {
      value = rawIntervention;
    } else if (rawIntervention && typeof rawIntervention.value === 'number') {
      value = rawIntervention.value;
    } else {
      // Invalid intervention - use NaN so it won't match anything valid
      value = NaN;
    }
    pairs.push([nodeId, normaliseValue(value)]);
  }

  // Sort by node_id for deterministic ordering
  pairs.sort((a, b) => a[0].localeCompare(b[0]));

  // Join into canonical string
  return pairs.map(([nodeId, value]) => `${nodeId}:${value}`).join('|');
}

// -----------------------------------------------------------------------------
// Duplicate Detection
// -----------------------------------------------------------------------------

/**
 * Result of identical options check.
 */
export interface IdenticalOptionsResult {
  /** True if duplicates were found */
  hasDuplicates: boolean;
  /** Pairs of duplicate option labels (if any) */
  duplicatePairs: Array<[string, string]>;
}

/**
 * Check for identical options after canonical normalization.
 *
 * Two options are identical if their intervention sets produce
 * the same canonical string representation.
 *
 * @param options Options to check
 * @returns Result with duplicate pairs (if any)
 */
export function checkIdenticalOptions(options: OptionV3[]): IdenticalOptionsResult {
  const seen = new Map<string, string>(); // canonical → first option label
  const duplicatePairs: Array<[string, string]> = [];

  for (const option of options) {
    const canonical = canonicaliseInterventions(option.interventions);

    if (seen.has(canonical)) {
      // Found a duplicate
      const firstLabel = seen.get(canonical)!;
      duplicatePairs.push([firstLabel, option.label]);
    } else {
      seen.set(canonical, option.label);
    }
  }

  return {
    hasDuplicates: duplicatePairs.length > 0,
    duplicatePairs,
  };
}

/**
 * Get a human-readable message for identical options.
 *
 * @param duplicatePairs Array of [label1, label2] pairs
 * @returns User-friendly error message
 */
export function formatIdenticalOptionsMessage(
  duplicatePairs: Array<[string, string]>
): string {
  if (duplicatePairs.length === 0) {
    return '';
  }

  if (duplicatePairs.length === 1) {
    const [label1, label2] = duplicatePairs[0];
    return `Options '${label1}' and '${label2}' are identical. Each option must represent a different decision path.`;
  }

  const pairs = duplicatePairs
    .map(([label1, label2]) => `'${label1}' and '${label2}'`)
    .join(', ');

  return `Multiple pairs of identical options found: ${pairs}. Each option must represent a different decision path.`;
}
