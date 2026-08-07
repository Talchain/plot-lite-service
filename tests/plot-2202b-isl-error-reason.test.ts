/**
 * ROADMAP 2.202 fix ①b — `ISLHttpError.body` gets its FIRST READER.
 *
 * THE DEFECT: `ISLHttpError` has captured `public body: string` on every ISL
 * error since it was written, and **nothing ever read it**. The 31 Jul live probe
 * established that with a passing positive control, at a pinned SHA:
 *
 *   $ rg -a -c "body" src/integrations/isl/*.ts
 *   errors.ts:4   index.ts:9   client.ts:18       ← POSITIVE CONTROL: search works
 *   $ rg -a -n "\.body\b" src/ --glob '!**\/tests\/**' | rg -a -i isl
 *   (no matches)                                  ← ZERO readers, at b79c4829
 *
 * That is trap 10's write-only column, sitting in the one field that names WHY
 * ISL's compute governor rejected the call. The consequence was concrete: the
 * probe's Render search for `caller_concurrency_exceeded` returned 0 rows and the
 * probe had to record that zero as **VACUOUS** — PLoT never logged the body, so
 * the search could not have found it either way. Diagnosis §8.3 stayed open for
 * want of one field.
 *
 *   PROBE OF RECORD: PHASE0-EVIDENCE-2026-07-28/probe-2202-retry-under-contention.md §8
 *
 * ⚠ THE BODIES BELOW ARE DERIVED FROM ISL AT THE BYTES, NOT INVENTED HERE.
 * A fixture written at this end proves whatever it was written to prove (trap 16
 * / trap 18). Read read-only at `Talchain/Inference-Service-Layer@7c681fda`
 * (`staging`, 2026-07-31):
 *   • src/services/compute_governor.py:161 → `raise Overload(429, "caller_concurrency_exceeded")`
 *   • src/services/compute_governor.py:159 → `raise Overload(503, "service_busy_queue_full")`
 *   • src/api/robustness.py:249-273 → `ErrorResponse(code=…, message=…, reason=overload.reason, …)`
 *   • src/api/robustness.py:362-370 → `JSONResponse(status_code=…, content=body.model_dump(exclude_none=True))`
 *   • src/models/responses.py:90-103 → `class ErrorResponse: code: str; message: str; reason: Optional[str]`
 */

import { describe, it, expect } from 'vitest';
import {
  parseIslErrorReason,
  ISLHttpError,
  ISL_ERROR_REASON_MAX_LEN,
} from '../src/integrations/isl/errors.js';

/**
 * The LIVE 429 body, assembled from ISL's own `_overload_error_response` at the
 * ref above. Flat object; `reason` carries the governor's token.
 */
const ISL_GOVERNOR_429_BODY = JSON.stringify({
  code: 'RATE_LIMIT_EXCEEDED',
  message: 'Too many concurrent analyses from this caller. Retry shortly.',
  reason: 'caller_concurrency_exceeded',
  recovery: {
    hints: [
      'Reduce the number of simultaneous /analyze requests you issue',
      'Retry after the Retry-After interval',
    ],
    suggestion: 'Retry after Retry-After seconds',
  },
  retryable: true,
  source: 'isl',
  request_id: 'p2202-a-r1-2',
});

/** The service-wide 503 from the same helper — a different reason, same shape. */
const ISL_GOVERNOR_503_BODY = JSON.stringify({
  code: 'SERVICE_UNAVAILABLE',
  message: 'Analysis service is at compute capacity. Retry shortly.',
  reason: 'service_busy_queue_full',
  retryable: true,
  source: 'isl',
});

describe('2.202 ①b — parseIslErrorReason names the governor cause the probe could not read', () => {
  it('⭐ the REAL ISL 429 body yields `caller_concurrency_exceeded`', () => {
    expect(parseIslErrorReason(ISL_GOVERNOR_429_BODY)).toBe('caller_concurrency_exceeded');
  });

  it('the 503 arm yields its own distinct reason — not a constant that matches anything', () => {
    // Trap 13's discrimination requirement: a parser that returned the same
    // token for every body would pass the test above and be useless.
    expect(parseIslErrorReason(ISL_GOVERNOR_503_BODY)).toBe('service_busy_queue_full');
  });

  it('the FastAPI `detail` shape is read too — that is what PLoT\'s own 2.202 fakes serve', () => {
    // tests/plot-2202-isl-429-retry.route.test.ts:90 and
    // tests/plot-2202-isl-retry-after.client.test.ts:56 both answer
    // `{"detail":"caller_concurrency_exceeded"}`. Reading only ISL's real shape
    // would leave every in-repo harness silently unable to exercise this path.
    expect(parseIslErrorReason('{"detail":"caller_concurrency_exceeded"}'))
      .toBe('caller_concurrency_exceeded');
  });

  it('`reason` WINS over the coarser `code` when both are present', () => {
    // The live body carries both. `RATE_LIMIT_EXCEEDED` would not have told the
    // probe anything it did not already know from the status line.
    expect(parseIslErrorReason(ISL_GOVERNOR_429_BODY)).not.toBe('RATE_LIMIT_EXCEEDED');
    expect(parseIslErrorReason('{"code":"RATE_LIMIT_EXCEEDED"}')).toBe('RATE_LIMIT_EXCEEDED');
    expect(parseIslErrorReason('{"error":{"code":"ISL_INVALID_DAG"}}')).toBe('ISL_INVALID_DAG');
  });

  it('absent / non-JSON / non-string causes read as MISSING, never as a fabricated reason', () => {
    expect(parseIslErrorReason(undefined)).toBeUndefined();
    expect(parseIslErrorReason(null)).toBeUndefined();
    expect(parseIslErrorReason('')).toBeUndefined();
    expect(parseIslErrorReason('   ')).toBeUndefined();
    expect(parseIslErrorReason('Internal Server Error')).toBeUndefined(); // plain text
    expect(parseIslErrorReason('{"message":"boom"}')).toBeUndefined(); // no cause field
    expect(parseIslErrorReason('{"reason":123}')).toBeUndefined(); // wrong type
    expect(parseIslErrorReason('{"reason":"   "}')).toBeUndefined(); // blank
    expect(parseIslErrorReason('[1,2,3]')).toBeUndefined(); // array, not an object
    expect(parseIslErrorReason('null')).toBeUndefined();
  });

  it('a hostile / oversized body cannot turn one log field into a body dump', () => {
    const huge = 'x'.repeat(5_000);
    const out = parseIslErrorReason(JSON.stringify({ reason: huge }))!;
    expect(out.length).toBeLessThanOrEqual(ISL_ERROR_REASON_MAX_LEN + 1); // + the ellipsis
    // Newlines stripped so one field cannot forge additional NDJSON log lines.
    expect(parseIslErrorReason(JSON.stringify({ reason: 'a\nb\r{"event":"forged"}' })))
      .toBe('a b {"event":"forged"}');
  });

  it('ROADMAP 2.879 — the stripped set is the FULL C0 range plus DEL, exhaustively', () => {
    // BACKS A SUPPRESSION. `no-control-regex` is disabled on exactly one line in
    // src/integrations/isl/errors.ts because the control characters there are the
    // point of the expression, not an accident. A suppression asserted in a comment
    // is worth nothing, so the behaviour it protects is pinned here BY EXECUTION and
    // EXHAUSTIVELY, rather than by the two representative characters (CR, LF) the
    // case above happens to use. Narrow the class in errors.ts and this reds by name.
    //
    // ORACLE CORRECTION, derived from running it rather than from reading the regex:
    // 0x20 (SPACE) is UNOBSERVABLE through this parser. The sanitiser replaces each
    // stripped character WITH a space, so a surviving space and a stripped space
    // produce byte-identical output. My first version of this test classified 0x20 as
    // "stripped" and was wrong about the code while agreeing with itself. It is now
    // excluded by name, and the exclusion set is itself asserted, so a future change
    // that made some OTHER codepoint ambiguous reds here instead of hiding.
    const stripped: number[] = [];
    const kept: number[] = [];
    const unobservable: number[] = [];

    // Sweep the whole Latin-1 space so the boundaries are measured, not assumed:
    // 0x00-0x1F must strip, 0x21-0x7E must survive, 0x7F must strip, 0x80+ survives.
    for (let cp = 0x00; cp <= 0xff; cp++) {
      const ch = String.fromCharCode(cp);
      // Sentinels either side so trim() cannot mask an edge codepoint, and so a
      // parser that returned a constant could not satisfy this.
      const out = parseIslErrorReason(JSON.stringify({ reason: `A${ch}Z` }));
      const survived = `A${ch}Z`;
      const replaced = 'A Z';
      if (survived === replaced) unobservable.push(cp);
      else if (out === replaced) stripped.push(cp);
      else if (out === survived) kept.push(cp);
      else throw new Error(`unexpected output for cp 0x${cp.toString(16)}: ${JSON.stringify(out)}`);
    }

    const expectedStripped = [
      ...Array.from({ length: 0x20 }, (_, i) => i), // C0 controls 0x00-0x1F
      0x7f, // DEL
    ];
    expect(stripped).toEqual(expectedStripped);

    // The ambiguity is bounded to the one codepoint that IS the replacement char.
    expect(unobservable).toEqual([0x20]);

    // POSITIVE CONTROL — the sweep must actually be discriminating. Without these a
    // parser that stripped EVERYTHING, or a sweep that observed nothing at all,
    // could still satisfy the equality above.
    expect(stripped).toHaveLength(33);
    expect(kept).toHaveLength(256 - 33 - 1);
    expect(kept).toContain(0x21); // '!' survives — the codepoint directly above the boundary
    expect(kept).toContain(0x7e); // '~' survives — directly below DEL
    expect(kept).toContain(0x80); // C1 is deliberately NOT in the class
    expect(kept).not.toContain(0x00);
    expect(kept).not.toContain(0x7f);

    // And the security property the suppression exists for, stated directly: no
    // output may carry a character that could forge an NDJSON log line.
    for (let cp = 0x00; cp <= 0xff; cp++) {
      const ch = String.fromCharCode(cp);
      const out = parseIslErrorReason(JSON.stringify({ reason: `A${ch}Z` }))!;
      // Deliberately NOT the production regex: an independent codepoint predicate,
      // so this asserts the property rather than mirroring the implementation.
      const carriesControl = Array.from(out).some((c) => {
        const n = c.charCodeAt(0);
        return n <= 0x1f || n === 0x7f;
      });
      expect(carriesControl).toBe(false);
    }
  });
});

describe('2.202 ①b — ISLHttpError.getReason() is the reader that closes the write-only field', () => {
  it('⭐ reads the body captured at construction', () => {
    const err = new ISLHttpError(
      429, ISL_GOVERNOR_429_BODY, '/api/v1/robustness/analyze/v2', undefined, 5_000,
    );
    expect(err.getReason()).toBe('caller_concurrency_exceeded');
    // The rest of the class is unchanged.
    expect(err.status).toBe(429);
    expect(err.isRetryable()).toBe(true);
    expect(err.retryAfterMs).toBe(5_000);
  });

  it('CONTROL — an error whose body carries no cause returns undefined', () => {
    // Without this the assertion above could pass against a parser that returns
    // a constant, and the "absence" half of the telemetry would be unproven.
    const err = new ISLHttpError(500, 'boom', '/api/v1/robustness/analyze/v2');
    expect(err.getReason()).toBeUndefined();
    expect(err.isRetryable()).toBe(true);
  });
});
