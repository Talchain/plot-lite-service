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
    delete meta.request_id_chain; // Volatile tracing field (varies per-request)
    delete meta.commit; // Volatile between CI and local dev
    normalised.meta = meta;
  }
  
  // Remove response_hash from model_card to avoid circularity and
  // strip volatile timestamps from provenance_summary
  if (normalised.model_card && typeof normalised.model_card === 'object') {
    const model_card = { ...(normalised.model_card as Record<string, unknown>) };
    delete model_card.response_hash;
    if (model_card.provenance_summary && typeof model_card.provenance_summary === 'object') {
      const prov = { ...(model_card.provenance_summary as Record<string, unknown>) };
      delete (prov as any).collected_at;
      model_card.provenance_summary = prov;
    }
    normalised.model_card = model_card;
  }
  
  // Remove any debug/timing fields at root
  delete normalised.debug;
  delete normalised.timing;
  delete normalised.duration_ms;

  // Remove request_id at root level (varies per-request, not deterministic)
  delete normalised.request_id;

  // Additive margin-sensitivity diagnostic — excluded from response_hash so
  // that adding this enrichment does not perturb existing canonical hashes.
  //  - Top-level: flip_thresholds_margin_status, flip_thresholds_margin_coverage
  //  - Per-entry: flip_thresholds[].margin_sensitivity
  delete normalised.flip_thresholds_margin_status;
  delete normalised.flip_thresholds_margin_coverage;
  const flipThresholds = normalised.flip_thresholds;
  if (Array.isArray(flipThresholds)) {
    normalised.flip_thresholds = flipThresholds.map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const copy = { ...(entry as Record<string, unknown>) };
        delete copy.margin_sensitivity;
        return copy;
      }
      return entry;
    });
  }

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
  const { debug, ...rest } = doc as any;
  const copy: any = { ...rest, model_card: { ...(doc as any).model_card } };
  // Ensure we hash the payload without the response_hash to avoid circularity
  delete copy.model_card.response_hash;
  const hash = sha256Stable(copy);
  copy.model_card.response_hash = hash;
  // Add debug back (excluded from hash but included in response)
  if (debug !== undefined) {
    copy.debug = debug;
  }
  return copy as T;
}

/**
 * Build canonical input object for result.response_hash
 * Picks only the 7 input keys, excludes debug, sorted keys
 */
export function buildCanonicalInput(body: any): object {
  const canonical: any = {};
  
  // Pick only the 7 input keys in sorted order
  if (body.baseline_value !== undefined) canonical.baseline_value = body.baseline_value;
  if (body.graph !== undefined) canonical.graph = body.graph;
  if (body.inference_mode !== undefined) canonical.inference_mode = body.inference_mode;
  if (body.k_samples !== undefined) canonical.k_samples = body.k_samples;
  if (body.outcome_node !== undefined) canonical.outcome_node = body.outcome_node;
  if (body.seed !== undefined) canonical.seed = body.seed;
  if (body.treatment_node !== undefined) canonical.treatment_node = body.treatment_node;
  
  return canonical;
}

/**
 * Compute SHA-256 hash of canonical input (for result.response_hash)
 */
export function hashCanonicalInput(body: any): string {
  const canonical = buildCanonicalInput(body);
  const json = stableStringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}
