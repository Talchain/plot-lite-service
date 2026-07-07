/**
 * Downstream Call Tracker
 *
 * Tracks downstream service calls (CEE, ISL) during request processing.
 * Uses a request-ID keyed Map for Fastify compatibility.
 * Each request gets its own isolated call log.
 */

import { createHash } from 'node:crypto';

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
}

/**
 * Request-scoped storage for downstream calls, keyed by request ID.
 * Auto-cleanup happens after 5 minutes to prevent memory leaks.
 */
const downstreamStore = new Map<string, { calls: DownstreamCall[]; createdAt: number }>();

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
  }
  // If no entry exists (request not initialized), silently ignore
  // This handles cases where tracking wasn't initialized for this request
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
 * Get downstream calls as array for boundary log inclusion.
 *
 * @param requestId - The unique request ID
 * @returns Array of call objects suitable for JSON logging
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
    request_payload: call.requestPayload,
    response_payload: call.responsePayload,
    ...(call.errorBody && { error_body: call.errorBody }),
    // Lane PLoT-R3 (2.13): additive digest passthrough for _meta.evidence
    ...(call.requestDigest && { request_digest: call.requestDigest }),
    ...(call.responseDigest && { response_digest: call.responseDigest }),
  }));
}

// -----------------------------------------------------------------------------
// Payload Sanitization for Debug
// -----------------------------------------------------------------------------

const MAX_ARRAY_ITEMS = 30;
const SENSITIVE_KEYS = new Set(['password', 'secret', 'token', 'api_key', 'apiKey', 'authorization']);

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
