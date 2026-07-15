/**
 * PII redaction helpers — Wave1-L1 (Codex F8 residual closure).
 *
 * Rule: raw factor labels and node/decision values must never appear in logs
 * or response bodies. These helpers replace them with short content digests
 * ("sha8:xxxxxxxx" — first 8 hex chars of sha256) while PRESERVING JSON
 * SHAPE (same keys, same nesting, same array lengths), so consumers that
 * navigate the structure keep working and equal inputs remain correlatable
 * across log lines / responses without being recoverable.
 */

import { createHash } from 'node:crypto';

/**
 * Digest a single scalar to the log/response-safe "sha8:xxxxxxxx" form.
 * Deterministic: the same label/value always digests identically, so
 * correlation ("is this the same node?") survives redaction.
 */
export function sha8(value: string | number): string {
  return 'sha8:' + createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 8);
}

/**
 * Keys whose STRING values are structural service metadata (never
 * decision inputs) and stay readable after redaction:
 *  - `build`: downstream service version string — PLoT's own
 *    `_meta.builds.isl` reads `response_payload.build` (see v2/run.ts).
 */
const STRING_KEY_ALLOWLIST = new Set(['build']);

/**
 * Keys whose NUMBER values are structural counts emitted by
 * sanitizePayloadForDebug's array-truncation marker — safe and useful.
 */
const NUMBER_KEY_ALLOWLIST = new Set(['_original_length', '_shown']);

/**
 * Sentinel emitted by the credential sanitiser; kept verbatim so redacted
 * payloads still show WHERE a credential key was scrubbed.
 */
const REDACTED_SENTINEL = '[REDACTED]';

/**
 * Deep, shape-preserving redaction of a decision-domain payload:
 *  - strings and numbers → "sha8:xxxxxxxx" digests (labels AND values —
 *    node ids, factor labels, observed values, means, stds, bounds);
 *  - booleans / null / undefined → unchanged (structural);
 *  - arrays → same length, elements redacted;
 *  - objects → same keys, values redacted (key NAMES are structural and
 *    kept — they are the "key manifest" a debugger needs).
 *
 * Use for any downstream request/response body that is echoed into an API
 * response or log. NOT for product display fields (e.g. factor_sensitivity
 * labels in the /v2/run envelope), which return the caller's own data.
 */
export function redactPayloadShape(payload: unknown): unknown {
  if (payload === null || payload === undefined || typeof payload === 'boolean') {
    return payload;
  }
  if (typeof payload === 'string') {
    return payload === REDACTED_SENTINEL ? payload : sha8(payload);
  }
  if (typeof payload === 'number') {
    return sha8(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map(redactPayloadShape);
  }
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (STRING_KEY_ALLOWLIST.has(key) && typeof value === 'string') {
        out[key] = value;
      } else if (NUMBER_KEY_ALLOWLIST.has(key) && typeof value === 'number') {
        out[key] = value;
      } else {
        out[key] = redactPayloadShape(value);
      }
    }
    return out;
  }
  // bigint / symbol / function — cannot appear in parsed JSON; digest defensively.
  return sha8(String(payload));
}
