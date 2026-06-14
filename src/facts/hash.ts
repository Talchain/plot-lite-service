/**
 * Deterministic hashing for FactObjectV1.
 *
 * - fact_id: hash(fact_key + lineage) — content-addressable, stable per analysis run
 * - content_hash: hash(canonical JSON of data payload)
 *
 * Uses SHA-256 truncated to 16 hex chars for compact IDs.
 */

import { createHash } from 'node:crypto';
import type { FactKey, FactLineage, FactData } from './types.js';

/**
 * Produce canonical JSON: keys sorted recursively, no whitespace.
 * Ensures deterministic serialisation regardless of property insertion order.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
}

/**
 * SHA-256 of an arbitrary string, returned as full hex digest.
 */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a deterministic fact_id from fact_key + lineage.
 *
 * Uses `canonicalJson(factKey) + ":" + lineage fields` as the pre-image,
 * then SHA-256 truncated to 16 hex chars.
 */
export function generateFactId(factKey: FactKey, lineage: FactLineage): string {
  const keyPayload = canonicalJson(factKey);
  let lineagePayload = `${lineage.graph_hash}:${lineage.seed}:${lineage.config_version}:${lineage.isl_request_id}`;
  // Track S: depth-aware fact ids. Appended ONLY when present so pre-Track-S
  // facts (no n_samples) keep their original ids — facts computed at different
  // sample depths get distinct ids.
  if (lineage.n_samples !== undefined) {
    lineagePayload += `:${lineage.n_samples}`;
  }
  return sha256(`${keyPayload}:${lineagePayload}`).slice(0, 16);
}

/**
 * Generate content_hash from the canonical JSON of a fact's data payload.
 * SHA-256 truncated to 16 hex chars.
 */
export function generateContentHash(data: FactData): string {
  return sha256(canonicalJson(data)).slice(0, 16);
}
