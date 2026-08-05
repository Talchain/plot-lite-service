/**
 * Downstream Call Tracker
 *
 * Tracks downstream service calls (CEE, ISL) during request processing.
 * Uses a request-ID keyed Map for Fastify compatibility.
 * Each request gets its own isolated call log.
 */

import { createHash } from 'node:crypto';

import { redactPayloadShape, sha8 } from './pii-redact.js';

/**
 * Lane PLoT-R3 (roadmap 2.13): diligence-grade content digest of an exact
 * wire payload. Carries enough to verify a separately captured payload
 * matches what PLoT actually exchanged — WITHOUT shipping the body:
 *   - sha256 over the exact serialised bytes (request: the JSON.stringify'd
 *     body sent; response: the raw response text received);
 *   - byte length (UTF-8);
 *   - sorted top-level key manifest ([] for non-object payloads).
 */
export interface PayloadDigest {
  sha256: string;
  bytes: number;
  key_manifest: string[];
}

/**
 * Compute a PayloadDigest from the exact serialised text of a payload.
 * `parsed` provides the top-level key manifest (pass the object the text
 * serialises to / parses from; non-objects yield an empty manifest).
 */
export function computePayloadDigest(text: string, parsed: unknown): PayloadDigest {
  const keys =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.keys(parsed as Record<string, unknown>).sort()
      : [];
  return {
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(text, 'utf8'),
    key_manifest: keys,
  };
}

/**
 * Represents a single downstream service call
 */
export interface DownstreamCall {
  /** Service identifier: 'cee' | 'isl' */
  service: string;
  /** API endpoint path */
  endpoint: string;
  /** HTTP response status code */
  status: number;
  /** Call duration in milliseconds */
  elapsedMs: number;
  /** 12-char payload hash sent to downstream */
  payloadHash: string;
  /** 12-char response hash from downstream (if available) */
  responseHash?: string;
  /** X-Request-Id forwarded to downstream */
  requestId: string;
  /** Sanitized request payload for debug (optional, truncated if large) */
  requestPayload?: unknown;
  /** Sanitized response payload for debug (optional, truncated if large) */
  responsePayload?: unknown;
  /** Error response body for non-200 responses (truncated to 1000 chars) */
  errorBody?: string;
  /** Lane PLoT-R3 (2.13): digest of the exact request bytes sent downstream */
  requestDigest?: PayloadDigest;
  /** Lane PLoT-R3 (2.13): digest of the exact response bytes received */
  responseDigest?: PayloadDigest;
  /** 2.13 gap D: request id the downstream service echoed back (x-request-id), null if absent */
  echoedRequestId?: string | null;
}

/**
 * Request-scoped storage for downstream calls, keyed by request ID.
 * Auto-cleanup happens after 5 minutes to prevent memory leaks.
 */
const downstreamStore = new Map<string, { calls: DownstreamCall[]; createdAt: number }>();

/**
 * ROADMAP 2.510 — records that arrived for a request id with NO initialised
 * entry. Keyed by the id the RECORD ATTEMPTED to use.
 *
 * This map exists so that "zero downstream calls happened" and "calls happened
 * and the tracker lost them" need not render identically. Before 2.510
 * `recordDownstreamCall` dropped unkeyed records on the floor and every reader
 * saw an empty list — the instrument reported silence when it had gone deaf.
 *
 * ⚠ SCOPE OF THE BOUNDARY SIGNAL — the attempted key is NOT always the reader's
 * key. It coincides for the `/v2/run` id-resolution seam this row fixes, which
 * is why `x-olumi-downstream-lost` surfaces there. It does NOT coincide where a
 * downstream caller derives its own id: `/v1/run` -> `orchestrateCeeReview` ->
 * `sanitizeRequestId` substitutes `randomUUID()` for any client id failing
 * `^[A-Za-z0-9._-]+$` or exceeding 64 chars, so the orphan lands under a UUID
 * the reader never looks up and the response still reads
 * `downstream: null, downstream_lost: 0`. In THAT case the loud
 * `downstream_tracker.unkeyed_record` log line is the only signal — which is
 * precisely why the alarm is not merely a counter. Rowed separately; not a
 * regression (pre-2.510 that record was dropped with no signal at all).
 */
const orphanedStore = new Map<string, { calls: DownstreamCall[]; createdAt: number }>();

// Periodic cleanup of stale entries (run every 60 seconds)
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of downstreamStore) {
      if (now - entry.createdAt > STALE_THRESHOLD_MS) {
        downstreamStore.delete(key);
      }
    }
    for (const [key, entry] of orphanedStore) {
      if (now - entry.createdAt > STALE_THRESHOLD_MS) {
        orphanedStore.delete(key);
      }
    }
  }, 60_000);
  // Don't keep process alive just for cleanup
  if (cleanupInterval.unref) cleanupInterval.unref();
}

/**
 * Initialize downstream tracking for a request.
 * Call this at the start of request processing.
 *
 * @param requestId - The unique request ID
 */
export function initDownstreamTracking(requestId: string): void {
  ensureCleanup();
  downstreamStore.set(requestId, { calls: [], createdAt: Date.now() });
  // 2.510 review fix — OPENING a scope must also reset its loss ledger, not just
  // closing one. A record can land AFTER `clearDownstreamTracking` (a late or
  // detached downstream completion), which creates an orphan under an id that no
  // longer has a scope. Without this line the NEXT request reusing that id — the
  // CEE retry shape — inherited the previous request's loss and emitted
  // `x-olumi-downstream-lost` on a COMPLETE response. Measured before the fix:
  // afterClear=0 -> afterLateRecord=1 -> afterReinit=1.
  //
  // This matters as much as the silent drop it accompanies: an alarm that fires
  // on a healthy request is how an alarm gets muted, and a muted alarm fails
  // exactly as silently as the one this row exists to fix.
  orphanedStore.delete(requestId);
}

/**
 * Record a downstream service call.
 *
 * @param call - The downstream call to record
 */
export function recordDownstreamCall(call: DownstreamCall): void {
  const entry = downstreamStore.get(call.requestId);
  if (entry) {
    entry.calls.push(call);
    return;
  }

  // ROADMAP 2.510 — FAIL LOUD. This branch used to `return` silently, which is
  // why a dead tracker was indistinguishable from a quiet one for four days.
  // An unrecordable call is now (a) retained under the key it attempted, so the
  // boundary reader can report the loss, and (b) alarmed on the sanctioned
  // structured console channel. It is deliberately NOT thrown: these call sites
  // sit inside the live ISL/CEE request path, and turning an observability
  // fault into a request failure would be a worse defect than the one fixed.
  ensureCleanup();
  let orphan = orphanedStore.get(call.requestId);
  if (!orphan) {
    orphan = { calls: [], createdAt: Date.now() };
    orphanedStore.set(call.requestId, orphan);
  }
  orphan.calls.push(call);

  console.error(
    JSON.stringify({
      level: 'error',
      time: Date.now(),
      event: 'downstream_tracker.unkeyed_record',
      request_id: call.requestId,
      service: call.service,
      endpoint: call.endpoint,
      status: call.status,
      orphaned_calls_for_request_id: orphan.calls.length,
      msg:
        'A downstream call could not be attributed to an initialised request scope. ' +
        'The call HAPPENED; the tracker could not key it. This is a tracker-keying ' +
        'fault (the recording id does not match the id tracking was initialised under), ' +
        'NOT an absence of downstream traffic.',
    }),
  );
}

/**
 * ROADMAP 2.510 — move an in-flight request's tracking to the id the route
 * actually resolved, and mutate `req.id` to match, as ONE operation.
 *
 * THE CAUSE THIS FIXES. Tracking is initialised in the `onRequest` hook, which
 * runs BEFORE body parsing and therefore cannot see `body.request_id`. The
 * route resolves the real id later (`trimmed X-Request-Id` → `body.request_id`
 * → `req.id`) and used to mutate `req.id` on its own. The store kept the
 * ORIGINAL key while every `recordDownstreamCall` used the RESOLVED one, so two
 * sites independently decided what "the request id" was — a hand-maintained
 * mirror (programme trap 12) that silently dropped every record whenever they
 * disagreed.
 *
 * Exposing the id change ONLY through this function makes the disagreement
 * structurally impossible: a caller cannot move the id without moving the
 * store, because both happen here.
 */
export function adoptResolvedRequestId(req: { id: unknown }, resolvedId: string): void {
  const previousId = String(req.id);
  if (previousId === resolvedId) return;

  // Carry the entry across. If tracking was never initialised (init is wrapped
  // in a try/catch at the hook), create one rather than leaving a hole that
  // would make every later record an orphan.
  const entry = downstreamStore.get(previousId) ?? { calls: [], createdAt: Date.now() };
  downstreamStore.delete(previousId);
  downstreamStore.set(resolvedId, entry);
  // 2.510 review fix, second limb. Adoption OPENS a scope under `resolvedId`,
  // so it owes the same ledger reset as `initDownstreamTracking`. Without this,
  // the body.request_id path kept the loophole the init fix closed for headers:
  // `initDownstreamTracking` runs under Fastify's generated id, never under the
  // resolved one, so a stale orphan under `resolvedId` survived and the request
  // cried loss on a complete response. Every site that opens a scope resets the
  // ledger for the id it opens — no exceptions, or the alarm goes false again.
  orphanedStore.delete(resolvedId);

  req.id = resolvedId;
}

/**
 * ROADMAP 2.510 — how many downstream calls were recorded for this request id
 * but could NOT be attributed to an initialised scope. `0` means "nothing was
 * lost"; any positive number means the downstream list for this request is
 * INCOMPLETE and must not be read as an absence of traffic.
 */
export function getOrphanedDownstreamCallCount(requestId: string): number {
  return orphanedStore.get(requestId)?.calls.length ?? 0;
}

/**
 * Get all recorded downstream calls for a request.
 *
 * @param requestId - The unique request ID
 * @returns Array of downstream calls, or empty array if not found
 */
export function getDownstreamCalls(requestId: string): DownstreamCall[] {
  const entry = downstreamStore.get(requestId);
  return entry?.calls ?? [];
}

/**
 * Clear downstream tracking for a request (call at end of request).
 *
 * @param requestId - The unique request ID
 */
export function clearDownstreamTracking(requestId: string): void {
  downstreamStore.delete(requestId);
  // 2.510: the orphan ledger is per-request too — clear it with its request.
  // NOTE: this close-side delete is NOT on its own sufficient to stop a reused
  // id inheriting a stale loss — a record can arrive after this runs. The
  // guarantee comes from the matching delete in `initDownstreamTracking`, which
  // resets the ledger when the next scope OPENS. Both sides are required; see
  // the ordering test `an orphan recorded AFTER clear does not leak into the
  // next request that reuses the id`.
  orphanedStore.delete(requestId);
}

/**
 * Format downstream calls for the x-olumi-downstream-calls header.
 *
 * Format: service:status:elapsedMs:payloadHash:responseHash;...
 * Example: cee:200:1200:abc123def456:xyz789012345;isl:200:340:def456789012:qrs456789012
 *
 * @param requestId - The unique request ID
 * @returns Formatted header string, or empty string if no calls
 */
export function formatDownstreamHeader(requestId: string): string {
  const calls = getDownstreamCalls(requestId);
  if (calls.length === 0) {
    return '';
  }

  return calls
    .map((call) => {
      const parts = [
        call.service,
        String(call.status),
        String(call.elapsedMs),
        call.payloadHash,
        call.responseHash || '-',
      ];
      return parts.join(':');
    })
    .join(';');
}

/**
 * Get downstream calls as array for the /v2/run response body (and `_meta`).
 *
 * Wave1-L1 (Codex F8 residual): the echoed request/response bodies are
 * SHAPE-PRESERVING DIGESTS — same keys, same nesting, but every raw factor
 * label / node id / decision value replaced with "sha8:xxxxxxxx" (see
 * pii-redact.ts). `error_body` is digested to a single sha8 string (ISL
 * validation errors quote node labels/values). Correlation metadata
 * (hashes, digests, timing, status, endpoint, request ids) and the
 * structural `build` version string are retained verbatim.
 *
 * @param requestId - The unique request ID
 * @returns Array of call objects safe for response-body echo / JSON logging
 */
export function getDownstreamCallsForLog(requestId: string): Array<{
  service: string;
  endpoint: string;
  status: number;
  elapsed_ms: number;
  payload_hash: string;
  response_hash: string | null;
  request_id: string;
  request_payload?: unknown;
  response_payload?: unknown;
  error_body?: string;
  request_digest?: PayloadDigest;
  response_digest?: PayloadDigest;
}> {
  return getDownstreamCalls(requestId).map((call) => ({
    service: call.service,
    endpoint: call.endpoint,
    status: call.status,
    elapsed_ms: call.elapsedMs,
    payload_hash: call.payloadHash,
    response_hash: call.responseHash || null,
    request_id: call.requestId,
    request_payload:
      call.requestPayload === undefined ? undefined : redactPayloadShape(call.requestPayload),
    response_payload:
      call.responsePayload === undefined ? undefined : redactPayloadShape(call.responsePayload),
    ...(call.errorBody && { error_body: sha8(call.errorBody) }),
    // Lane PLoT-R3 (2.13): additive digest passthrough for _meta.evidence
    ...(call.requestDigest && { request_digest: call.requestDigest }),
    ...(call.responseDigest && { response_digest: call.responseDigest }),
  }));
}

// -----------------------------------------------------------------------------
// Decision-input minimiser — log-safe downstream projection (F1/F3)
// -----------------------------------------------------------------------------

/**
 * Log-safe view of a downstream call. Carries ONLY correlation/observability
 * metadata — hashes, digests (sha256 + byte size + top-level key manifest),
 * timing, status, endpoint and request IDs. It deliberately DROPS the
 * decision-domain payload bodies (`request_payload` / `response_payload` /
 * `error_body`) that carry node/factor labels, raw factor values, baseline
 * means and parameter_uncertainties — none of which belong in INFO structured
 * logs.
 */
export interface LogSafeDownstreamCall {
  service: string;
  endpoint: string;
  status: number;
  elapsed_ms: number;
  payload_hash: string;
  response_hash: string | null;
  request_id: string;
  echoed_request_id?: string | null;
  /** sha256 + byte length + sorted top-level key manifest of the request bytes */
  request_digest?: PayloadDigest;
  /** sha256 + byte length + sorted top-level key manifest of the response bytes */
  response_digest?: PayloadDigest;
  /** Present ONLY under the diagnostic body-capture gate (default off) */
  request_payload?: unknown;
  /** Present ONLY under the diagnostic body-capture gate (default off) */
  response_payload?: unknown;
  /** Present ONLY under the diagnostic body-capture gate (default off) */
  error_body?: string;
}

/**
 * Explicit, default-OFF diagnostic gate for capturing full (still
 * credential-redacted) request/response bodies in structured logs. Intended
 * for short-lived, sampled debugging only — set the env var deliberately, and
 * unset it once the investigation is done. When unset the log path emits
 * digests + timing + status only.
 */
export function isDiagnosticBodyCaptureEnabled(): boolean {
  const v = process.env.PLOT_DIAGNOSTIC_LOG_BODIES;
  return v === '1' || v === 'true';
}

/**
 * Project the recorded downstream calls for a request into a LOG-SAFE shape for
 * INFO structured logs (e.g. `boundary.response`). Retains hashes, digests,
 * sizes (via digest.bytes), key manifests, timing, status, endpoint and request
 * IDs so ops correlation / chain tracing / debugging still work — and drops the
 * decision-input bodies. Full bodies are included ONLY when the explicit
 * diagnostic gate {@link isDiagnosticBodyCaptureEnabled} is on.
 *
 * NOTE: this is distinct from {@link getDownstreamCallsForLog}, which keeps
 * the body CARRIERS for the /v2/run response + `_meta` but redacts their
 * contents to shape-preserving sha8 digests (Wave1-L1, Codex F8 residual).
 */
export function getDownstreamCallsForBoundaryLog(requestId: string): LogSafeDownstreamCall[] {
  const includeBodies = isDiagnosticBodyCaptureEnabled();
  return getDownstreamCalls(requestId).map((call) => {
    const safe: LogSafeDownstreamCall = {
      service: call.service,
      endpoint: call.endpoint,
      status: call.status,
      elapsed_ms: call.elapsedMs,
      payload_hash: call.payloadHash,
      response_hash: call.responseHash ?? null,
      request_id: call.requestId,
      ...(call.echoedRequestId !== undefined && { echoed_request_id: call.echoedRequestId }),
      ...(call.requestDigest && { request_digest: call.requestDigest }),
      ...(call.responseDigest && { response_digest: call.responseDigest }),
    };
    if (includeBodies) {
      if (call.requestPayload !== undefined) safe.request_payload = call.requestPayload;
      if (call.responsePayload !== undefined) safe.response_payload = call.responsePayload;
      if (call.errorBody) safe.error_body = call.errorBody;
    }
    return safe;
  });
}

// -----------------------------------------------------------------------------
// Payload Sanitization for Debug
// -----------------------------------------------------------------------------

const MAX_ARRAY_ITEMS = 30;
// F9 (decision-input minimiser): keys are compared LOWER-CASED (see below), so
// every entry here MUST be lower-case. Previously `apiKey` sat in this set
// mixed-case and `key.toLowerCase()` (`apikey`) never matched it, so a
// camelCase `apiKey` credential rode through un-redacted. Store `apikey`.
const SENSITIVE_KEYS = new Set(['password', 'secret', 'token', 'api_key', 'apikey', 'authorization']);

/**
 * Sanitize a payload for debug output.
 * - Truncates arrays with more than MAX_ARRAY_ITEMS
 * - Redacts sensitive keys
 * - Deep clones to avoid mutating originals
 */
export function sanitizePayloadForDebug(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (Array.isArray(payload)) {
    const truncated = payload.length > MAX_ARRAY_ITEMS;
    const items = payload.slice(0, MAX_ARRAY_ITEMS).map(sanitizePayloadForDebug);
    if (truncated) {
      return {
        _truncated: true,
        _original_length: payload.length,
        _shown: MAX_ARRAY_ITEMS,
        items,
      };
    }
    return items;
  }

  if (typeof payload === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = sanitizePayloadForDebug(value);
      }
    }
    return result;
  }

  return payload;
}
