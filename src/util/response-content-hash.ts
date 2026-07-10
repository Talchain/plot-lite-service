/**
 * Deterministic response-CONTENT hash for /v2/run (ROADMAP 2.13).
 *
 * The existing `response_hash` is a REQUEST-canonical determinism token
 * (sha256 of the canonicalised request; by design — the UI freshness gate
 * keys on it and it must never change meaning). Until 2.13 there was NO
 * deterministic hash of what PLoT actually returned: the only body hash was
 * the x-olumi-response-hash header, which covers volatile fields
 * (latency_ms, timestamps) and is therefore not reproducible across runs.
 *
 * `response_content_hash` closes that gap: sha256 (16 hex, "rch_v1:"-prefixed)
 * over the PUBLIC semantic surface of the response — the full body minus
 * the `_meta` diagnostic subtree and minus the volatile field set below —
 * with the natural-key array sorts the determinism-replay suite uses, so a
 * replayed identical request yields an identical hash. It is attached to
 * `_meta.response_content_hash` AFTER computation, so it never hashes itself,
 * and it never feeds `hashRequest` (request-hash stability preserved).
 *
 * The exclusion list is exported so tests (and external verifiers) recompute
 * the hash independently — "zero hash mismatches" is asserted, not assumed.
 * Keep it aligned with tests/determinism-replay.test.ts IGNORE_FIELDS: a new
 * volatile field that breaks replay-stability of this hash must be added in
 * BOTH places, as a conscious decision.
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../facts/hash.js';

export const RESPONSE_CONTENT_HASH_VERSION = 'rch_v1';

/** Field names stripped (deep, by key) before hashing — the volatile set. */
export const RESPONSE_CONTENT_HASH_EXCLUDED_KEYS: readonly string[] = [
  // Diagnostic subtree (builds, digests, payloads, this hash itself)
  '_meta',
  // Per-request identity & call traces
  'request_id',
  'request_id_chain',
  'requestId',
  'plot_request_id',
  'cee_sent_request_id',
  'downstream_calls',
  // Timing
  'computed_at',
  'processing_time_ms',
  'latency_ms',
  'timing',
  'normalization_ms',
  'validation_ms',
  'isl_ms',
  'cee_ms',
  'timestamp',
  // Per-run generated identifiers
  'id',        // critique UUIDs (semantic ids use option_id/edge_id/factor_id)
  'brief_id',
  'created_at',
  'fact_objects',
  // Presence depends on ISL call timing, not deterministic inputs (B10.3)
  'thresholds_status',
  'thresholds_meta',
  'threshold_analysis',
  // Deployment/environment provenance, not response content: meta.build is
  // the deployed git SHA (changes every commit — a checked-in golden or
  // cross-deploy replay would flip the hash with identical content), and
  // meta.feature_flags is an environment snapshot carried for diagnostics.
  'build',
  'feature_flags',
  // Safety: never self-referential wherever it is attached
  'response_content_hash',
];

/**
 * Top-level arrays sorted by natural key before hashing — mirrors the
 * determinism-replay suite's SORT_ARRAYS_BY so element-order jitter can't
 * flip the hash between replays.
 */
export const RESPONSE_CONTENT_HASH_SORTED_ARRAYS: Readonly<Record<string, string>> = {
  option_comparison: 'option_id',
  edge_sensitivity: 'edge_id',
  factor_sensitivity: 'factor_id',
  critiques: 'code',
};

function stripVolatile(value: unknown, excluded: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripVolatile(v, excluded));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (excluded.has(k)) continue;
      out[k] = stripVolatile(v, excluded);
    }
    return out;
  }
  return value;
}

/**
 * Compute the deterministic content hash of a /v2/run response body.
 * Pass the body WITHOUT `_meta.response_content_hash` attached (the field is
 * stripped defensively anyway via the exclusion list).
 */
export function computeResponseContentHash(body: unknown): string {
  const excluded = new Set(RESPONSE_CONTENT_HASH_EXCLUDED_KEYS);
  const stripped = stripVolatile(body, excluded);

  if (stripped !== null && typeof stripped === 'object' && !Array.isArray(stripped)) {
    const record = stripped as Record<string, unknown>;
    for (const [field, sortKey] of Object.entries(RESPONSE_CONTENT_HASH_SORTED_ARRAYS)) {
      const arr = record[field];
      if (Array.isArray(arr)) {
        record[field] = [...arr].sort((a, b) =>
          String((a as Record<string, unknown>)?.[sortKey] ?? '')
            .localeCompare(String((b as Record<string, unknown>)?.[sortKey] ?? '')),
        );
      }
    }
  }

  const digest = createHash('sha256')
    .update(canonicalJson(stripped), 'utf8')
    .digest('hex')
    .slice(0, 16);
  return `${RESPONSE_CONTENT_HASH_VERSION}:${digest}`;
}
