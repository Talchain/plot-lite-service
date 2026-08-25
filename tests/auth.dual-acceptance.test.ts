/**
 * Dual-acceptance auth: ACTIVE + STAGED, for zero-downtime bearer rotation.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `authGuard` accepts exactly ONE token. Every caller therefore has to change in
 * the same instant the server's value changes: CEE's Render env, the UI's Netlify
 * env, and the `PLOT_AUTH_TOKEN` GitHub Actions secret used by `staging-smoke.yml`
 * and `load-probe-nightly.yml`. There is no ordering of those edits that avoids a
 * window where something is sending a value the server no longer accepts.
 *
 * That matters beyond convenience. The smoke workflow runs on every push to
 * staging, so a blind cutover kills the check that would tell us the cutover broke
 * something — the alarm dies with the thing it monitors.
 *
 * ── THE ACCEPTANCE CRITERION IS THE METRIC, NOT THE SECOND TOKEN ───────────
 * Accepting two tokens is the easy half. The half that makes rotation SAFE is
 * being able to prove the old token has stopped being used before deleting it.
 * Without "which candidate matched", removal is a guess — the same failure mode
 * as invalidating blind, just deferred. So `plot_engine_auth_token_match_total`
 * is the deliverable and the dual read is what makes it possible.
 *
 * Modelled on the rotation pattern this repo already runs for a different secret
 * (`verifyPrincipalSignature` / `incPrincipalSecretFallback`, P0-2) rather than a
 * second mechanism under a different name.
 *
 * ── ⚠ THE PRIMARY CORRECTNESS REQUIREMENT: NO LENGTH SHORT-CIRCUIT ─────────
 * The pre-change guard reads:
 *
 *     if (!expectedToken || providedToken.length !== expectedToken.length) → 403
 *     if (!timingSafeEqual(provided, expected))                            → 403
 *
 * The length test exists because `timingSafeEqual` throws on unequal lengths. With
 * TWO candidates, a naive extension checks length against ACTIVE and returns 403
 * before STAGED is ever considered. That is wrong twice over:
 *
 *   1. FUNCTIONALLY — a staged token of a different length is rejected, so the
 *      rotation silently does not work for the case it exists to serve (rotating
 *      to a NEW secret, which will not share the old one's length).
 *   2. AS A DISCLOSURE — the work performed varies with WHICH candidate the
 *      provided token happens to match on length, so the guard's behaviour is a
 *      function of a property of the secrets. A rotation mechanism that leaks
 *      which of two secrets you are holding is worse than the problem it solves.
 *
 * So each candidate is length-checked and compared INDEPENDENTLY, and both are
 * evaluated unconditionally — no `||` short-circuit, which would skip the second
 * comparison whenever the first matched.
 *
 * `DIFFERENT_LENGTH_STAGED` below is the discriminating fixture: it is deliberately
 * a different length from the active token, so it fails against the pre-change
 * guard and passes only against a per-candidate implementation. A staged token of
 * EQUAL length would pass either way and prove nothing.
 *
 * No token value is ever asserted into a response, a log, a metric or /health —
 * the metric reports which candidate matched, never what it was.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import {
  renderAuthTokenMatch,
  __resetAuthTokenMetricsForTest,
} from '../src/observability/authTokenMetrics.js';

/** Obviously synthetic. Never a real or realistic-looking credential. */
const ACTIVE_TOKEN = 'active-token-aaaaaaaaaaaa';
/** ⭐ DELIBERATELY a different length from ACTIVE — this is what makes the pin bite. */
const DIFFERENT_LENGTH_STAGED = 'staged-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';
/** Same length as ACTIVE, for the "wrong bytes" arm. */
const WRONG_SAME_LENGTH = 'wrongX-token-aaaaaaaaaaaa';

/**
 * Collect every JSON path whose VALUE discloses `length`.
 *
 * ⚠ WHY THIS EXISTS, AND WHY THE OBVIOUS VERSION IS WRONG. This replaced
 * `expect(body).not.toContain(String(ACTIVE_TOKEN.length))` — a bare substring
 * search for `'25'` over the whole serialised `/health` document. That payload
 * embeds an ISO timestamp (`"since":"2026-08-25T00:29:35.020Z"`), so the check
 * collided with THE DAY OF THE MONTH: it passed on the 24th, failed on the
 * 25th, and would fail on the 25th of every month thereafter. It blocked
 * `scripts/pre-push-validate.sh` — and therefore every push to this repo — for
 * hours, and NOTHING about the cause was visible until somebody read the
 * assertion instead of the failure message, which only ever said
 * "expected … not to contain '25'".
 *
 * The INTENT was right and is kept: a bare count narrows a brute-force search,
 * so the token's length must never appear. The INSTRUMENT was wrong. A
 * substring search over a document full of dates, byte counts and latencies
 * will collide with an unrelated number sooner or later, and any 2-digit
 * length collides often — so the shape is wrong regardless of which length is
 * chosen.
 *
 * This scans VALUES, not text, and reports the offending PATH so the next
 * failure names its own cause:
 *
 *  · STRING values are flagged ANYWHERE. A bare `"25"` string is not ordinary
 *    telemetry, and a length rendered into a field is the likelier leak shape.
 *  · NUMBER values are flagged only on an AUTH-ADJACENT path. Ordinary
 *    operational integers (`uptime_s`, `rss_mb`, `heap_used_mb`,
 *    `eventloop_delay_ms`) can legitimately equal a small length on some run —
 *    flagging those would rebuild the very time-bomb this replaces, just
 *    rarer, and a rare bomb is worse because it detonates when nobody
 *    remembers why.
 *
 * The plausible carrier is closed EXHAUSTIVELY and separately by the
 * `toEqual({ active: true, staged: true })` assertion below: that is a deep
 * equality, so ANY extra key or non-boolean value under `auth_secrets` fails
 * it regardless of name. Residual, stated rather than hidden: a length
 * disclosed as a NUMBER under a non-auth-named key outside `auth_secrets`
 * would not be caught here.
 */
function findLengthDisclosures(value: unknown, length: number, path = '$'): string[] {
  const hits: string[] = [];
  /** A leak of a COUNT is only meaningful where the count is about the secret. */
  const AUTH_ADJACENT = /auth|secret|token|credential|key/i;

  const walk = (node: unknown, at: string): void => {
    if (typeof node === 'string') {
      if (node === String(length)) hits.push(`${at} (string "${node}")`);
      return;
    }
    if (typeof node === 'number') {
      if (node === length && AUTH_ADJACENT.test(at)) {
        hits.push(`${at} (number ${node})`);
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${at}[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`);
    }
  };

  walk(value, path);
  return hits;
}

let app: FastifyInstance;
let port = 0;
const prev = {
  AUTH_ENABLED: process.env.AUTH_ENABLED,
  AUTH_TOKEN: process.env.AUTH_TOKEN,
  PLOT_AUTH_TOKEN: process.env.PLOT_AUTH_TOKEN,
  PLOT_AUTH_TOKEN_STAGED: process.env.PLOT_AUTH_TOKEN_STAGED,
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
};

const BASE = () => `http://127.0.0.1:${port}`;
const get = (token?: string) =>
  fetch(`${BASE()}/v1/health`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

beforeAll(async () => {
  process.env.AUTH_ENABLED = '1';
  delete process.env.AUTH_TOKEN;
  process.env.PLOT_AUTH_TOKEN = ACTIVE_TOKEN;
  process.env.PLOT_AUTH_TOKEN_STAGED = DIFFERENT_LENGTH_STAGED;
  process.env.RATE_LIMIT_ENABLED = '0';
  app = await createServer({ enableTestRoutes: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
});

beforeEach(() => {
  process.env.PLOT_AUTH_TOKEN = ACTIVE_TOKEN;
  process.env.PLOT_AUTH_TOKEN_STAGED = DIFFERENT_LENGTH_STAGED;
  __resetAuthTokenMetricsForTest();
});

describe('CONTROL — the fixture is live, so the assertions below are not vacuous', () => {
  it('the ACTIVE token is accepted (trap 13: prove a presence before asserting an absence)', async () => {
    expect((await get(ACTIVE_TOKEN)).status).toBe(200);
  });

  it('the two tokens are DIFFERENT LENGTHS — the property the pin depends on', () => {
    expect(DIFFERENT_LENGTH_STAGED.length).not.toBe(ACTIVE_TOKEN.length);
  });
});

describe('⭐ PRIMARY: no length short-circuit — each candidate is checked independently', () => {
  it('accepts a STAGED token whose length DIFFERS from ACTIVE', async () => {
    // Against the pre-change guard this is 403: the length test runs once, against
    // ACTIVE, and returns before STAGED is considered. This is THE pin.
    expect((await get(DIFFERENT_LENGTH_STAGED)).status).toBe(200);
  });

  it('still rejects a wrong token that happens to match ACTIVE length', async () => {
    expect((await get(WRONG_SAME_LENGTH)).status).toBe(403);
  });

  it('still rejects a wrong token that happens to match STAGED length', async () => {
    const wrongStagedLength = 'z'.repeat(DIFFERENT_LENGTH_STAGED.length);
    expect((await get(wrongStagedLength)).status).toBe(403);
  });

  it('a rejection is 403 regardless of WHICH candidate length it matched — no behavioural tell', async () => {
    const matchesActiveLength = await get('q'.repeat(ACTIVE_TOKEN.length));
    const matchesStagedLength = await get('q'.repeat(DIFFERENT_LENGTH_STAGED.length));
    const matchesNeither = await get('q'.repeat(7));
    expect(matchesActiveLength.status).toBe(403);
    expect(matchesStagedLength.status).toBe(403);
    expect(matchesNeither.status).toBe(403);
    // Identical error SHAPE: the response must not disclose which candidate was
    // closer. Compared on code/message, not the raw body — every error carries a
    // unique `request_id`, so a raw-text comparison could never match and the
    // assertion would fail for a reason that has nothing to do with disclosure.
    const shapeOf = async (r: Response) => {
      const body = JSON.parse(await r.text()) as { code?: string; message?: string };
      return `${r.status}|${body.code}|${body.message}`;
    };
    const shapes = await Promise.all([
      shapeOf(matchesActiveLength),
      shapeOf(matchesStagedLength),
      shapeOf(matchesNeither),
    ]);
    expect(new Set(shapes).size).toBe(1);
  });
});

describe('⭐ ACCEPTANCE CRITERION: the metric proves which token is still in use', () => {
  it('records a match against ACTIVE', async () => {
    await get(ACTIVE_TOKEN);
    expect(renderAuthTokenMatch()).toContain('used="active"} 1');
  });

  it('records a match against STAGED', async () => {
    await get(DIFFERENT_LENGTH_STAGED);
    expect(renderAuthTokenMatch()).toContain('used="staged"} 1');
  });

  it('DISCRIMINATES: after only-staged traffic, active reads 0 — the signal that permits deletion', async () => {
    await get(DIFFERENT_LENGTH_STAGED);
    await get(DIFFERENT_LENGTH_STAGED);
    const rendered = renderAuthTokenMatch();
    expect(rendered).toContain('used="staged"} 2');
    expect(rendered).toContain('used="active"} 0');
  });

  it('a REJECTED token increments neither counter', async () => {
    await get(WRONG_SAME_LENGTH);
    const rendered = renderAuthTokenMatch();
    expect(rendered === '' || rendered.includes('used="active"} 0')).toBe(true);
    expect(rendered === '' || rendered.includes('used="staged"} 0')).toBe(true);
  });

  it('NEVER emits a token value', async () => {
    // ⚠ THE REQUESTS ARE LOAD-BEARING, NOT SETUP. `renderAuthTokenMatch()` returns
    // '' until something has matched, and `beforeEach` resets the counters — so an
    // assertion made without driving traffic first checks "'' does not contain the
    // token", which is true of every possible implementation.
    //
    // That is not hypothetical: this test was written that way, and a mutation that
    // rendered the ACTIVE token straight into the exposition SURVIVED it. Both
    // candidates are exercised so the rendered output is non-empty for the right
    // reason, and the non-emptiness is asserted before the absence is.
    await get(ACTIVE_TOKEN);
    await get(DIFFERENT_LENGTH_STAGED);
    const rendered = renderAuthTokenMatch();
    expect(rendered).not.toBe('');
    expect(rendered).toContain('used="active"} 1');
    expect(rendered).toContain('used="staged"} 1');
    expect(rendered).not.toContain(ACTIVE_TOKEN);
    expect(rendered).not.toContain(DIFFERENT_LENGTH_STAGED);
  });

  it('/health exposes rotation PRESENCE only — never a value, length or prefix', async () => {
    // The ROOT `/health` (open) carries the operational payload; `/v1/health` is a
    // different, auth-gated route and does not. Asserted against the one that
    // actually publishes it — an operator watching a rotation reads this one.
    const body = await (await fetch(`${BASE()}/health`)).text();
    const parsed = JSON.parse(body) as { auth_secrets?: { active?: unknown; staged?: unknown } };
    // Bind by identity: the booleans must actually be present and true here, so a
    // renamed or dropped field fails rather than silently satisfying the absence.
    expect(parsed.auth_secrets).toEqual({ active: true, staged: true });
    expect(body).not.toContain(ACTIVE_TOKEN);
    expect(body).not.toContain(DIFFERENT_LENGTH_STAGED);
    // No length disclosure either — a bare count would narrow a brute-force
    // search. Asserted over VALUES with their paths, never as a substring of
    // the serialised blob; see `findLengthDisclosures` for the calendar
    // collision that formulation caused.
    expect(findLengthDisclosures(parsed, ACTIVE_TOKEN.length)).toEqual([]);
  });

  // -------------------------------------------------------------------
  // THE DISCRIMINATING PAIR. Neither half proves anything alone: the first
  // shows the property is still guarded, the second shows the collision is
  // actually closed. Run against synthetic bodies so both are deterministic
  // and neither depends on today's date.
  // -------------------------------------------------------------------
  it('POSITIVE CONTROL — a body that genuinely discloses the token length is CAUGHT', () => {
    const len = ACTIVE_TOKEN.length;
    // Three shapes a real disclosure could take.
    const asNumberUnderAuthKey = { auth_secrets: { active: true, active_token_length: len } };
    const asStringAnywhere = { runtime: { some_field: String(len) } };
    const nestedInArray = { callers: [{ token_len: len }] };

    expect(findLengthDisclosures(asNumberUnderAuthKey, len)).not.toEqual([]);
    expect(findLengthDisclosures(asStringAnywhere, len)).not.toEqual([]);
    expect(findLengthDisclosures(nestedInArray, len)).not.toEqual([]);
    // The path is reported, so a future failure names its own cause rather
    // than saying only "does not contain '25'".
    expect(findLengthDisclosures(asNumberUnderAuthKey, len)[0])
      .toContain('auth_secrets.active_token_length');
  });

  it('COLLISION CONTROL — a body whose DATE contains the length is NOT caught', () => {
    const len = ACTIVE_TOKEN.length;
    // The exact payload fragment that broke the gate: the day-of-month is 25.
    const withCollidingDate = {
      status: 'ok',
      auth_secrets: { active: true, staged: true },
      route_callers: { since: '2026-08-25T00:29:35.020Z' },
      // and the other collision classes the old substring search would trip on
      runtime: { uptime_s: 25, rss_mb: 125, heap_used_mb: 254 },
      rate_limit: { cooldownMs: 25000 },
    };
    expect(findLengthDisclosures(withCollidingDate, len)).toEqual([]);

    // PIN THE PRECONDITION: this fixture really does contain the digits, so
    // the assertion above passes because the SCAN discriminates, not because
    // the fixture happens to be clean. The old assertion fails on it.
    expect(JSON.stringify(withCollidingDate)).toContain(String(len));
  });
});

describe('BACKWARDS COMPATIBLE — unchanged behaviour when no STAGED is set', () => {
  beforeEach(() => {
    delete process.env.PLOT_AUTH_TOKEN_STAGED;
  });

  it('ACTIVE is accepted', async () => {
    expect((await get(ACTIVE_TOKEN)).status).toBe(200);
  });

  it('the former staged value is now rejected', async () => {
    expect((await get(DIFFERENT_LENGTH_STAGED)).status).toBe(403);
  });

  it('a missing bearer is still 401, not 403', async () => {
    expect((await get()).status).toBe(401);
  });
});

describe('FAIL CLOSED — no configured token accepts nothing', () => {
  it('403 when both ACTIVE and STAGED are absent', async () => {
    delete process.env.PLOT_AUTH_TOKEN;
    delete process.env.PLOT_AUTH_TOKEN_STAGED;
    expect((await get(ACTIVE_TOKEN)).status).toBe(403);
  });
});

describe('NO DISCLOSURE — a token value never reaches a response', () => {
  it('neither token appears in a success body/headers nor a rejection body', async () => {
    const ok = await get(ACTIVE_TOKEN);
    const okText = await ok.text();
    const okHeaders = JSON.stringify([...ok.headers.entries()]);
    const bad = await get(WRONG_SAME_LENGTH);
    const badText = await bad.text();
    for (const haystack of [okText, okHeaders, badText]) {
      expect(haystack).not.toContain(ACTIVE_TOKEN);
      expect(haystack).not.toContain(DIFFERENT_LENGTH_STAGED);
    }
  });
});
