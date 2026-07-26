/**
 * Regression pin: an unhandled route throw must be LOGGED, not silently
 * converted into an opaque 500.
 *
 * DEFECT: `createServer.ts` installs a custom `setErrorHandler`. Fastify does
 * not auto-log once a custom handler is installed, and the handler's fallback
 * branch replied `INTERNAL / "Something went wrong"` while logging NOTHING.
 * Measured on staging build 04f6dbac: zero level-50 records, and the error
 * message present nowhere in the log stream. A lane debugging a live 500 had
 * no log line to find — the failure was unexplainable by construction.
 *
 * The fix logs one error-level record correlated by request id. It carries the
 * error identity and stack only. It never carries the request body, headers or
 * query — and every field still passes through THE logger boundary
 * (`src/logging/log-boundary.ts`), which digests registered decision tokens, so
 * user content interpolated into an error message is scrubbed there.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

const THROW_ROUTE = '/__lane_p_unhandled_throw';
const THROW_MARKER = 'lane_p_unhandled_marker';
const CONTROL_MARKER = 'lane_p_log_capture_control';
const SECRET_ISH_BODY_VALUE = 'lane_p_body_value_must_not_be_logged';

let app: FastifyInstance;
let captured = '';
let controlSeen = false;

const prevAuth = process.env.AUTH_ENABLED;
const prevSecret = process.env.TOKEN_HMAC_SECRET;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TOKEN_HMAC_SECRET =
    process.env.TOKEN_HMAC_SECRET ||
    'abc123456789012345678901234567890123456789012345678901234567890123';

  // The stdout hook MUST be installed before createServer(): pino binds its
  // destination when the logger is constructed, so patching afterwards captures
  // nothing. That mistake makes every assertion below vacuous, which is exactly
  // what the positive control exists to catch — it did catch it.
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
    try {
      captured += String(chunk);
    } catch {
      /* ignore */
    }
    return (realWrite as any)(chunk, ...rest);
  };

  try {
    app = await createServer({});
    app.post(THROW_ROUTE, async () => {
      throw new TypeError(THROW_MARKER);
    });
    await app.ready();

    // POSITIVE CONTROL: a record we know is emitted. If this is not captured,
    // the probe is blind and every assertion below would pass or fail
    // vacuously — so the control is asserted first, as its own test.
    app.log.error({ evt: CONTROL_MARKER });

    await app.inject({
      method: 'POST',
      url: THROW_ROUTE,
      payload: { note: SECRET_ISH_BODY_VALUE },
    });
  } finally {
    (process.stdout as any).write = realWrite;
  }

  controlSeen = captured.includes(CONTROL_MARKER);
});

afterAll(async () => {
  if (app) await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED;
  else process.env.AUTH_ENABLED = prevAuth;
  if (prevSecret === undefined) delete process.env.TOKEN_HMAC_SECRET;
  else process.env.TOKEN_HMAC_SECRET = prevSecret;
});

describe('unhandled route errors are diagnosable', () => {
  it('POSITIVE CONTROL: the log probe can see log records at all', () => {
    expect(captured.length).toBeGreaterThan(0);
    expect(controlSeen).toBe(true);
  });

  it('emits an error-level log record for an unhandled throw', () => {
    expect(controlSeen).toBe(true); // guard: never assert on a blind probe
    const records = captured
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r): r is any => r !== null)
      .filter((r) => r.evt === 'unhandled_error');

    expect(records.length).toBeGreaterThan(0);
    const rec = records[0];

    expect(rec.level).toBe(50);
    expect(rec.route).toBe(THROW_ROUTE);
    expect(rec.err_name).toBe('TypeError');
    expect(String(rec.err_message)).toContain(THROW_MARKER);
    expect(String(rec.stack || '')).toContain('TypeError');
    // Correlates with the request_id the client is handed in the 500 body.
    expect(rec.id || rec.reqId).toBeTruthy();
  });

  /**
   * Two distinct claims, because the plaintext check alone cannot pin the
   * second one.
   *
   * Mutation-checked: injecting `body: req.body` into the log call did NOT
   * fail the plaintext assertion — THE logger boundary digested the value to
   * `{"sha8:...":"sha8:..."}` before it reached stdout. That is the boundary
   * doing its job, but it means "no plaintext" is a property of the boundary,
   * not of this log site. So the structural assertion below is what actually
   * pins this call site's payload; it is the one that goes red on that mutant.
   */
  it('does not leak the request body in plaintext', () => {
    expect(controlSeen).toBe(true); // guard: never assert absence on a blind probe
    expect(captured).not.toContain(SECRET_ISH_BODY_VALUE);
  });

  it('the unhandled_error record carries no body, headers or query field', () => {
    expect(controlSeen).toBe(true); // guard: never assert absence on a blind probe
    const rec = captured
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((r): r is any => r !== null)
      .find((r) => r.evt === 'unhandled_error');

    expect(rec).toBeTruthy(); // positive control: the record must exist to assert about it
    expect(rec).not.toHaveProperty('body');
    expect(rec).not.toHaveProperty('headers');
    expect(rec).not.toHaveProperty('query');
    expect(rec).not.toHaveProperty('payload');
  });
});
