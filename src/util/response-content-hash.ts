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
 * `response_content_hash` closes that gap: sha256 (16 hex, versioned prefix)
 * over the PUBLIC semantic surface of the response — the full body minus
 * the `_meta` diagnostic subtree and minus the volatile field set below.
 * It is attached inside buildResponse AFTER the body is assembled, so it
 * never hashes itself, and it never feeds `hashRequest` (request-hash
 * stability preserved).
 *
 * rch_v2 (review-hardening, 2026-07-11) changed the recipe from rch_v1:
 *   - array pre-sort uses locale-independent code-unit comparison (was
 *     localeCompare — ICU/locale-dependent, so the "independently
 *     recomputable" promise could break across Node builds);
 *   - equal natural keys tie-break on the elements' canonical serialisation
 *     (edge_sensitivity carries each edge_id twice — existence+magnitude —
 *     so a key-only sort left upstream order leaking into the hash);
 *   - `id` is stripped ONLY inside the `critiques` subtree (critique UUIDs),
 *     no longer globally — nested semantic `id` fields (e.g. review-card
 *     supporting_refs) are hashed content again;
 *   - single-pass serialisation (no intermediate deep clones).
 *
 * The exclusion list is exported so tests (and external verifiers) recompute
 * the hash independently — "zero hash mismatches" is asserted, not assumed.
 * SHARED_VOLATILE_KEYS is the single source the determinism-replay suite
 * derives its ignore-list from: a new volatile field is added ONCE, here.
 */

import { createHash } from 'node:crypto';

export const RESPONSE_CONTENT_HASH_VERSION = 'rch_v2';

/**
 * Volatile-by-key field names shared with the determinism-replay suite
 * (tests/determinism-replay.test.ts derives its IGNORE_FIELDS from this —
 * single source; do not fork a second list).
 */
export const SHARED_VOLATILE_KEYS: readonly string[] = [
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
  // Per-run generated identifiers / containers of them
  'brief_id',
  'created_at',
  'fact_objects',
  // Presence depends on ISL call timing, not deterministic inputs (B10.3)
  'thresholds_status',
  'thresholds_meta',
  'threshold_analysis',
];

/**
 * Additional exclusions specific to the content hash (NOT for the replay
 * suite, which deliberately still compares `_meta` contents):
 * `_meta` = diagnostic subtree (builds, digests, payloads, this hash);
 * `build`/`feature_flags` = deployment/environment provenance (meta.build is
 * the deployed git SHA — a checked-in golden or cross-deploy replay would
 * flip the hash with identical content); self-reference guard. `id` is NOT
 * here — it is stripped context-scoped, only inside `critiques` (see
 * serialize()).
 */
export const RESPONSE_CONTENT_HASH_EXCLUDED_KEYS: readonly string[] = [
  ...SHARED_VOLATILE_KEYS,
  '_meta',
  'build',
  'feature_flags',
  'response_content_hash',
];

/**
 * Top-level arrays pre-sorted by natural key before hashing, so element-order
 * jitter can't flip the hash between replays. The determinism-replay suite
 * derives its SORT_ARRAYS_BY from this map (single source). Ties on the
 * natural key (edge_sensitivity legitimately repeats edge_id) fall back to
 * the elements' canonical serialisation, so upstream ordering never leaks in.
 */
export const RESPONSE_CONTENT_HASH_SORTED_ARRAYS: Readonly<Record<string, string>> = {
  option_comparison: 'option_id',
  edge_sensitivity: 'edge_id',
  factor_sensitivity: 'factor_id',
  critiques: 'code',
};

/** Locale-independent code-unit string comparison (never localeCompare). */
function cmpCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Single-pass canonical serialiser: sorted object keys (code-unit order),
 * excluded keys dropped, `id` dropped only inside the `critiques` subtree.
 * Emits JSON text directly — no intermediate clone of the body.
 */
function serialize(value: unknown, insideCritiques: boolean, excluded: ReadonlySet<string>): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => serialize(v, insideCritiques, excluded) ?? 'null');
    return `[${parts.join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => !excluded.has(k) && !(insideCritiques && k === 'id'))
    .sort(cmpCodeUnit);
  const parts: string[] = [];
  for (const k of keys) {
    const v = serialize(record[k], insideCritiques || k === 'critiques', excluded);
    if (v !== undefined) parts.push(`${JSON.stringify(k)}:${v}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Compute the deterministic content hash of a /v2/run response body.
 * Safe to pass the fully-built body: `_meta` (and therefore any attached
 * response_content_hash) is excluded by construction.
 */
export function computeResponseContentHash(body: unknown): string {
  const excluded = new Set(RESPONSE_CONTENT_HASH_EXCLUDED_KEYS);
  let surface = body;

  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const overrides: Record<string, unknown> = {};
    for (const [field, sortKey] of Object.entries(RESPONSE_CONTENT_HASH_SORTED_ARRAYS)) {
      const arr = record[field];
      if (!Array.isArray(arr)) continue;
      const insideCritiques = field === 'critiques';
      overrides[field] = [...arr].sort((a, b) => {
        const ka = String((a as Record<string, unknown>)?.[sortKey] ?? '');
        const kb = String((b as Record<string, unknown>)?.[sortKey] ?? '');
        const primary = cmpCodeUnit(ka, kb);
        if (primary !== 0) return primary;
        // Tie-break: full canonical serialisation, so duplicate natural keys
        // (e.g. edge_sensitivity existence+magnitude rows) order stably.
        return cmpCodeUnit(
          serialize(a, insideCritiques, excluded) ?? 'null',
          serialize(b, insideCritiques, excluded) ?? 'null',
        );
      });
    }
    if (Object.keys(overrides).length > 0) {
      surface = { ...record, ...overrides };
    }
  }

  const canonical = serialize(surface, false, excluded) ?? 'null';
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
  return `${RESPONSE_CONTENT_HASH_VERSION}:${digest}`;
}
