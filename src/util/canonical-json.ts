import { createHash } from 'node:crypto';

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
  
  // Remove response_hash from model_card to avoid circularity
  if (normalised.model_card && typeof normalised.model_card === 'object') {
    const model_card = { ...(normalised.model_card as Record<string, unknown>) };
    delete model_card.response_hash;
    normalised.model_card = model_card;
  }
  
  // Remove any debug/timing fields at root
  delete normalised.debug;
  delete normalised.timing;
  delete normalised.duration_ms;
  
  // Normalize critique to array
  if ('critique' in normalised) {
    normalised.critique = normaliseCritique(normalised.critique);
  }
  
  return normalised;
}

/**
 * Coerce critique to array format
 * - null/undefined → []
 * - already array → passthrough
 * - object with numeric keys (e.g., {"0": {...}, "1": {...}}) → Object.values()
 * - single critique object → [obj]
 */
function normaliseCritique(critique: unknown): unknown[] {
  if (critique == null) return [];
  if (Array.isArray(critique)) return critique;
  if (typeof critique === 'object') {
    const obj = critique as Record<string, unknown>;
    const keys = Object.keys(obj);
    
    // Check if all keys are numeric (array-like object)
    const allNumeric = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
    
    if (allNumeric) {
      // Object with numeric keys → Object.values()
      return Object.values(obj);
    } else {
      // Single critique object → wrap in array
      return [obj];
    }
  }
  return [];
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
