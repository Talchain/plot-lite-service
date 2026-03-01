/**
 * DSK Canonical JSON Serialisation
 *
 * Produces a deterministic JSON string from a DSK bundle for hashing.
 * Rules:
 *  - Keys sorted alphabetically at every nesting level, no whitespace
 *  - Unordered set arrays sorted bytewise (context_tags, contraindications, etc.)
 *  - Ordered sequence arrays preserved as-is (steps, source_citations, etc.)
 *  - `objects` array sorted by `id` bytewise
 *  - `generated_at` and `dsk_version_hash` excluded from hash input
 */

import type { DSKBundle, DSKObject } from './types.js';

// ── Array classification ─────────────────────────────────────────────

/** Fields whose arrays are semantically unordered sets — sort for canonicalisation */
const UNORDERED_SET_FIELDS = new Set([
  'context_tags',
  'contraindications',
  'stage_applicability',
  'decision_contexts',   // inside scope
  'stages',              // inside scope
  'populations',         // inside scope
  'exclusions',          // inside scope
  'linked_claim_ids',
  'linked_protocol_ids',
  'negative_conditions',
]);

// ── Core canonicalisation ────────────────────────────────────────────

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
interface JsonArray extends Array<JsonValue> {}

function canonicaliseValue(value: JsonValue, fieldName?: string): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    // Recursively canonicalise each element
    const canonicalised = value.map((item) =>
      canonicaliseValue(item as JsonValue),
    );

    // Sort unordered set arrays bytewise
    if (fieldName && UNORDERED_SET_FIELDS.has(fieldName)) {
      canonicalised.sort((a, b) => {
        const sa = JSON.stringify(a);
        const sb = JSON.stringify(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    }

    return canonicalised as JsonArray;
  }

  // Object: sort keys alphabetically, recurse
  const out: JsonObject = {};
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    out[k] = canonicaliseValue((value as Record<string, unknown>)[k] as JsonValue, k);
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Produce a canonical JSON string from a DSK bundle.
 * Only `version` and `objects` are included in the hash input.
 * `objects` are sorted by `id` bytewise before serialisation.
 */
export function canonicalise(bundle: DSKBundle): string {
  // Sort objects by id
  const sortedObjects = [...bundle.objects].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // Build hash input: only version + objects
  const hashInput = {
    objects: sortedObjects,
    version: bundle.version,
  };

  const canonical = canonicaliseValue(hashInput as unknown as JsonValue);
  return JSON.stringify(canonical);
}

/**
 * Check whether the objects in a bundle are in canonical (id-sorted) order.
 * Returns the correctly sorted IDs if not in order, or null if already sorted.
 */
export function checkObjectOrder(objects: DSKObject[]): string[] | null {
  const ids = objects.map((o) => o.id);
  const sorted = [...ids].sort();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== sorted[i]) return sorted;
  }
  return null;
}
