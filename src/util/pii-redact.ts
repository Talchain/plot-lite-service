/**
 * PII redaction helpers — Wave1-L1 (Codex F8 residual closure + review-3
 * residuals).
 *
 * Rule: raw factor labels and node/decision ids and values must never appear
 * in logs or in echoed downstream payloads. These helpers replace them with
 * short SALTED digests ("sha8:xxxxxxxx") while PRESERVING JSON SHAPE (contract
 * key names, nesting, array lengths), so consumers that navigate the structure
 * keep working.
 *
 * Two properties, both load-bearing — read before changing anything here:
 *
 *  1. KEYS ARE CONTENT TOO. `interventions` (and `priors`) are Records KEYED
 *     BY NODE ID; node ids are label-derived slugs. Digesting only VALUES
 *     leaves the decision in the key. Contract-declared keys survive;
 *     everything else is digested (see isStructuralKey).
 *
 *  2. DIGESTS ARE SALTED, SO CORRELATION IS PER-PROCESS ONLY. An unsalted
 *     digest of a low-entropy decision value is reversible offline (review 3
 *     did it in 79ms). The salt is random per process — equal inputs match
 *     within a process, but NOT across restarts or replicas. Do not join
 *     digests across processes or treat them as stable ids. See DIGEST_SALT.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { STRUCTURAL_KEYS } from './structural-keys.generated.js';

/**
 * Per-process random salt, minted once at module load.
 *
 * WHY: an unsalted truncated sha256 over a decision value is trivially
 * reversible — the input space (node-id slugs, small numbers, dates) is tiny,
 * so anyone holding the logs can brute-force the pre-image offline. Review 3
 * recovered a digested decision value from its digest in 79ms.
 *
 * Keying the digest with a secret the attacker does not hold removes the
 * offline attack: without the salt there is nothing to precompute against.
 *
 * DELIBERATELY not read from the environment. A configured salt would be a
 * long-lived secret shared across deploys — it would leak, and once leaked
 * every historical digest becomes reversible again. A per-process random
 * value cannot leak through config and dies with the process.
 *
 * THE HONEST TRADE-OFF: correlation is PER-PROCESS ONLY.
 *  - Within one process, equal inputs digest equally — "are these two log
 *    lines about the same node?" is still answerable, which is the only
 *    property the logs actually need.
 *  - Across processes/restarts/instances, the SAME input digests
 *    DIFFERENTLY. Digests are intentionally unstable across restarts: do not
 *    join on them between processes, across a restart, or between replicas,
 *    and do not treat them as stable identifiers in dashboards or alerts.
 */
const DIGEST_SALT = randomBytes(32);

/**
 * Salted digest of a scalar, truncated to `length` hex chars.
 *
 * THE single digest primitive for this service — every log/response digest
 * must go through it. An unsalted `createHash('sha256')` over decision content
 * is reversible offline (see DIGEST_SALT) and must not be reintroduced.
 */
export function saltedDigestHex(value: string | number, length: number): string {
  return createHmac('sha256', DIGEST_SALT).update(String(value), 'utf8').digest('hex').slice(0, length);
}

/**
 * Digest a single scalar to the log/response-safe "sha8:xxxxxxxx" form.
 *
 * Salted HMAC-SHA256, truncated to 8 hex chars. Self-consistent within this
 * process (correlation survives); not reproducible outside it (see
 * DIGEST_SALT — digests do NOT survive a restart).
 */
export function sha8(value: string | number): string {
  return 'sha8:' + saltedDigestHex(value, 8);
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
 * Structural marker keys emitted by sanitizePayloadForDebug / the credential
 * sanitiser rather than declared in the wire contract. They are service
 * metadata, never decision content, so they survive as KEY names.
 */
const STRUCTURAL_MARKER_KEYS = new Set(['_original_length', '_shown', '_truncated']);

/**
 * Is this object key contract-defined (structural), or data-derived?
 *
 * Data-derived keys ARE decision content: `interventions` is a
 * `Record<string, InterventionValueV3>` keyed by NODE ID, and node ids are
 * label-derived slugs ("Acquire FintechCo for £50m" → "acquire-fintechco-for-50m").
 * Passing such a key through verbatim leaks exactly what digesting the VALUES
 * was meant to prevent — the residual review 3 found in downstream_calls and
 * _meta.payloads.
 *
 * The structural set is DERIVED from the contract type declarations
 * (see tools/gen-structural-keys.mjs), not hand-listed, so a new contract
 * field cannot silently start being digested — and, more importantly, an
 * unknown key defaults to DIGEST (fail-safe): a missing structural key costs
 * debuggability, never privacy.
 */
function isStructuralKey(key: string): boolean {
  return STRUCTURAL_KEYS.has(key) || STRUCTURAL_MARKER_KEYS.has(key);
}

/**
 * Redact known decision-domain tokens out of validation-error objects bound
 * for a LOG.
 *
 * Validators build prose that interpolates the offending node id — e.g.
 * field "priors.acquire-fintechco-for-50m", message "Prior specified for
 * unknown node: acquire-fintechco-for-50m" (validate-priors.ts,
 * validate-evidence.ts). Logging those objects verbatim leaks the raw id, the
 * same class Wave1-L1 closed elsewhere.
 *
 * `tokens` are the candidate raw ids from the REQUEST (priors keys, evidence
 * node_ids, graph node ids). Each occurrence is replaced by its digest, so the
 * message stays readable ("unknown node: sha8:1a2b3c4d") while the raw value
 * never reaches the log. Longest-first so an id that is a prefix of another
 * cannot be partially rewritten.
 *
 * NOTE scope: this is the LOG projection only. The /v1/run ERROR RESPONSE
 * still returns the raw message to the caller — that text is contract-visible
 * and changing it is a separate, client-impacting decision.
 */
export function redactValidationErrorsForLog(
  errors: ReadonlyArray<{ field: string; message: string }>,
  tokens: Iterable<string>,
): Array<{ field: string; message: string }> {
  const ordered = [...new Set([...tokens].filter((t) => typeof t === 'string' && t.length > 0))]
    .sort((a, b) => b.length - a.length);
  const scrub = (text: string): string => {
    let out = text;
    for (const token of ordered) {
      if (out.includes(token)) out = out.split(token).join(sha8(token));
    }
    return out;
  };
  return errors.map((e) => ({ field: scrub(e.field), message: scrub(e.message) }));
}

/**
 * Deep, shape-preserving redaction of a decision-domain payload:
 *  - strings and numbers → "sha8:xxxxxxxx" digests (labels AND values —
 *    node ids, factor labels, observed values, means, stds, bounds);
 *  - booleans / null / undefined → unchanged (structural);
 *  - arrays → same length, elements redacted;
 *  - objects → contract-defined KEY names kept (the "key manifest" a debugger
 *    needs); DATA-DERIVED key names digested (e.g. the node-id keys of
 *    `interventions`); all values redacted.
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
      // A key not declared by the contract is data-derived — the key itself is
      // decision content (node-id slugs keying `interventions`, `priors`, …).
      // Digest it. Unknown ⇒ digest is the FAIL-SAFE default.
      const outKey = isStructuralKey(key) ? key : sha8(key);
      if (STRING_KEY_ALLOWLIST.has(key) && typeof value === 'string') {
        out[outKey] = value;
      } else if (NUMBER_KEY_ALLOWLIST.has(key) && typeof value === 'number') {
        out[outKey] = value;
      } else {
        out[outKey] = redactPayloadShape(value);
      }
    }
    return out;
  }
  // bigint / symbol / function — cannot appear in parsed JSON; digest defensively.
  return sha8(String(payload));
}
