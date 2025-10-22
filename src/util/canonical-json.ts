import { createHash } from 'node:crypto';

/**
 * Canonical JSON Utilities
 * 
 * Provides deterministic, stable JSON serialization for hashing and snapshot testing.
 * All output is sorted, formatted consistently, and free of volatile fields.
 */

/**
 * Deterministic JSON stringification with sorted keys (JCS - RFC 8785).
 * - No whitespace (compact)
 * - Sorted object keys (recursive, lexicographic)
 * - Canonical number formatting
 * - No BOM
 */
export function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, sortedReplacer);
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
 * - trace_id (optional debug trace)
 * - meta.response_id (unique per response)
 * - meta.elapsed_ms (system load dependent)
 * - meta.generated_at (timestamp)
 * - meta.duration_ms (execution timing)
 * - meta.request_id (legacy)
 * - Any debug/timing fields
 * 
 * Preserved fields:
 * - schema version
 * - meta.seed (deterministic input)
 * - meta.commit, meta.version
 * - model_card (including response_hash, response_hash_algo, normalized)
 * - confidence
 * - All decision outputs
 * - warnings
 */
export function normaliseReport(report: unknown): unknown {
  if (typeof report !== 'object' || report === null) {
    return report;
  }
  
  // Deep clone to avoid mutation
  const obj = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  
  // Remove trace_id (optional debug field)
  delete obj.trace_id;
  
  // Remove volatile meta fields
  if (obj.meta && typeof obj.meta === 'object') {
    const meta = obj.meta as Record<string, unknown>;
    delete meta.response_id;      // Unique per response
    delete meta.elapsed_ms;       // System load dependent
    delete meta.generated_at;     // Timestamp
    delete meta.duration_ms;      // Execution timing
    delete meta.request_id;       // Legacy
  }
  
  // Remove any debug/timing fields at root
  delete obj.debug;
  delete obj.timing;
  delete obj.duration_ms;
  
  return obj;
}

// --- Hashing helpers ---

/**
 * Compute a SHA-256 hex string of the normalised, canonical JSON payload.
 */
export function sha256Stable(obj: unknown): string {
  const normalised = normaliseReport(obj);
  const canonical = stableStringify(normalised);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Stamp model_card.response_hash on a response document deterministically.
 * Does not mutate the original object; returns a shallow-cloned copy.
 */
export function stampResponseHash<T extends { model_card: object }>(doc: T): T {
  const copy: any = { ...doc, model_card: { ...doc.model_card } };
  // Ensure we hash the payload without the response_hash to avoid circularity
  delete copy.model_card.response_hash;
  const hash = sha256Stable(copy);
  copy.model_card.response_hash = hash;
  return copy as T;
}
