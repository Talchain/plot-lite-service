/**
 * Canonical JSON Utilities
 * 
 * Provides deterministic, stable JSON serialization for hashing and snapshot testing.
 * All output is sorted, formatted consistently, and free of volatile fields.
 */

/**
 * Deterministic JSON stringification with sorted keys.
 * - 2-space indentation
 * - Sorted object keys (recursive)
 * - No trailing whitespace
 * - No BOM
 * - Trailing newline
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, sortedReplacer, 2) + '\n';
}

/**
 * Replacer function that sorts object keys for deterministic output
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  
  // Sort object keys alphabetically
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    sorted[k] = (value as Record<string, unknown>)[k];
  }
  
  return sorted;
}

/**
 * Normalise a report by removing volatile fields.
 * Keeps only stable, deterministic fields for hashing and comparison.
 * 
 * Removed fields (if present):
 * - meta.generated_at (timestamp)
 * - meta.duration_ms (execution timing)
 * - Any debug/timing fields
 * 
 * Preserved fields:
 * - schema version
 * - meta.seed (deterministic input)
 * - model_card
 * - confidence
 * - All decision outputs
 * - warnings
 */
export function normaliseReport(report: unknown): unknown {
  if (typeof report !== 'object' || report === null) {
    return report;
  }
  
  const obj = report as Record<string, unknown>;
  const normalised = { ...obj };
  
  // Remove volatile meta fields
  if (normalised.meta && typeof normalised.meta === 'object') {
    const meta = { ...(normalised.meta as Record<string, unknown>) };
    delete meta.generated_at;
    delete meta.duration_ms;
    delete meta.request_id;
    normalised.meta = meta;
  }
  
  // Remove any debug/timing fields at root
  delete normalised.debug;
  delete normalised.timing;
  delete normalised.duration_ms;
  
  return normalised;
}
