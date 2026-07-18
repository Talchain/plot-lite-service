/**
 * F11 (Codex) — honest worst-case retry-time accounting.
 *
 * The base-call clamp, its telemetry, config-validator's startup budget warn, and
 * the base-call-budget test each computed `attempts × perAttemptTimeout` and
 * OMITTED the 1s+2s… exponential backoff the ISL client actually sleeps between
 * attempts — config-validator's comment even said "with exponential backoff"
 * while the arithmetic didn't. `worstCaseMs` centralises the HONEST formula so
 * none of them can re-omit it.
 *
 * RED-first / positive control: the first assertion (183_000, not 180_000) FAILS
 * against the old `attempts × perAttemptTimeout` formula. Reverting worstCaseMs to
 * `n * perAttemptTimeoutMs` turns this file RED — see the mutation transcript.
 */

import { describe, it, expect } from 'vitest';
import {
  worstCaseMs,
  islRetryBackoffMs,
  ISL_RETRY_BACKOFF_BASE_MS,
  ISL_RETRY_BACKOFF_CAP_MS,
} from '../src/config/timeouts.js';

describe('worstCaseMs — honest retry-time accounting (F11)', () => {
  it('includes the backoff slept BETWEEN attempts (not just attempts × timeout)', () => {
    // 3 attempts at 60s each = 180s of per-attempt budget PLUS the 1s + 2s backoff
    // slept between them = 183s. The OLD `attempts × timeout` returned 180s.
    expect(worstCaseMs(3, 60_000)).toBe(3 * 60_000 + 1_000 + 2_000);
    expect(worstCaseMs(3, 60_000)).toBe(183_000);
    // The exact omission this cluster removes — guards against a silent revert.
    expect(worstCaseMs(3, 60_000)).not.toBe(3 * 60_000);
  });

  it('a single attempt has zero backoff', () => {
    expect(worstCaseMs(1, 42_000)).toBe(42_000);
  });

  it('two attempts add exactly one 1s backoff', () => {
    expect(worstCaseMs(2, 5_000)).toBe(2 * 5_000 + 1_000);
  });

  it('backoff is capped at ISL_RETRY_BACKOFF_CAP_MS (5s), not unbounded doubling', () => {
    // 5 attempts → 4 inter-attempt backoffs: 1s, 2s, 4s, 5s(capped) = 12s
    // (NOT 1+2+4+8 = 15s). perAttempt=0 isolates the backoff sum.
    expect(worstCaseMs(5, 0)).toBe(1_000 + 2_000 + 4_000 + 5_000);
  });

  it('islRetryBackoffMs matches the client series and its cap', () => {
    expect(islRetryBackoffMs(1)).toBe(ISL_RETRY_BACKOFF_BASE_MS); // 1000
    expect(islRetryBackoffMs(2)).toBe(2_000);
    expect(islRetryBackoffMs(3)).toBe(4_000);
    expect(islRetryBackoffMs(4)).toBe(ISL_RETRY_BACKOFF_CAP_MS); // 8000 → capped 5000
    expect(islRetryBackoffMs(10)).toBe(ISL_RETRY_BACKOFF_CAP_MS);
  });

  it('degenerate attempt counts are safe (0 → 0)', () => {
    expect(worstCaseMs(0, 60_000)).toBe(0);
  });
});
