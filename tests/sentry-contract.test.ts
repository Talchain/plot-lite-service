/**
 * Sentry reporting contract (system S-H) — PLoT half.
 *
 * Rows run the REAL @sentry/node against the REAL createServer() (its decision-
 * token scope, its global error handler) over a real socket, with an in-memory
 * transport. "No user content is sent" is measured on the envelopes the SDK
 * would put on the wire.
 *
 * Each absence row has a precondition twin: the same error captured RAW in the
 * same request MUST carry the sentinel, so the harness provably sees it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import * as Sentry from '@sentry/node';
import { createServer } from '../src/createServer.js';
import {
  buildSentryOptions,
  initSentry,
  resetSentryForTests,
  resolveSentryEnvironment,
  scrubBreadcrumb,
  scrubSentryEvent,
} from '../src/observability/sentry.js';
import { getReleaseSha } from '../src/util/build-id.js';
import { runOutsideDecisionTokenScope } from '../src/logging/decision-tokens.js';

const SENTINEL = 'SENTINEL-3b9d-acquire-northwind-for-40m';
const SHA40 = '0123456789abcdef0123456789abcdef01234567';

const sent: string[] = [];

function collectingTransport() {
  return {
    send: async (envelope: unknown) => {
      sent.push(JSON.stringify(envelope));
      return { statusCode: 200 };
    },
    flush: async () => true,
  };
}

describe('PLoT Sentry contract (S-H): through the real SDK and server', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    resetSentryForTests();
    const env = {
      SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0',
      SENTRY_ENVIRONMENT: 'production',
      NODE_ENV: 'staging',
      RENDER_GIT_COMMIT: SHA40,
    } as NodeJS.ProcessEnv;
    // initSentry is the production entry; the transport is the only swap.
    expect(initSentry(env, { transport: collectingTransport })).toBe(true);

    app = await createServer({});
    app.post('/__s-h/boom', async (req) => {
      const body = req.body as { nodes: Array<{ label: string }>; raw?: boolean };
      const err = new Error(`no factor matches "${body.nodes[0].label}"`);
      if (body.raw) {
        // precondition twin: the same error captured OUTSIDE the request's
        // decision-token scope, i.e. what the SDK would send untouched.
        runOutsideDecisionTokenScope(() => Sentry.captureException(err));
        // and a raw capture INSIDE the scope, by code other than the 500 path
        Sentry.captureException(new Error(`in-scope capture for "${body.nodes[0].label}"`));
      }
      throw err;
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    await Sentry.close();
    resetSentryForTests();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  async function boom(raw: boolean): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/__s-h/boom`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SENTINEL}` },
      body: JSON.stringify({ nodes: [{ id: 'n1', label: SENTINEL }], raw }),
    });
    expect(res.status).toBe(500);
    await Sentry.flush(2000);
    return sent.join('\n');
  }

  it('precondition: the same error captured raw carries the label', async () => {
    const wire = await boom(true);
    expect(wire).toContain(SENTINEL);
  });

  it('ANY capture inside the request is digested too (beforeSend token arm), not only the 500 path', async () => {
    const wire = await boom(true);
    const events = sent.filter((e) => e.includes('"type":"event"'));
    // three events: raw out-of-scope capture (precondition), raw in-scope
    // capture, and the 500. Only the out-of-scope one may carry the label.
    expect(events.length).toBe(3);
    expect(events.filter((e) => e.includes(SENTINEL)).length).toBe(1);
    expect(events.some((e) => e.includes('in-scope capture for') && !e.includes(SENTINEL))).toBe(true);
    expect(wire).toContain('"route":"/__s-h/boom"');
  });

  it('a 500 reaches Sentry exactly once, from the error handler, tagged with its route', async () => {
    await boom(false);
    const events = sent.filter((e) => e.includes('"type":"event"'));
    expect(events.length).toBe(1);
    expect(events[0]).toContain('"route":"/__s-h/boom"');
    expect(events[0]).toContain('"request_id"');
  });

  it('a 500 reaches Sentry with no label, no body and no credential', async () => {
    const wire = await boom(false);
    expect(sent.length).toBeGreaterThan(0);
    // control: the failure itself is reported, with its digested message
    expect(wire).toContain('no factor matches');
    expect(wire).toMatch(/sha8:[0-9a-f]{8}/);
    expect(wire).not.toContain(SENTINEL);
  });

  it('the event carries service=plot, the environment override and the full SHA', async () => {
    const wire = await boom(false);
    expect(wire).toContain('"service":"plot"');
    expect(wire).toContain('"environment":"production"');
    expect(wire).toContain(SHA40);
  });
});

describe('PLoT Sentry contract (S-H): options and filter', () => {
  it('SENTRY_ENVIRONMENT wins over NODE_ENV; blank counts as unset', () => {
    expect(resolveSentryEnvironment({ SENTRY_ENVIRONMENT: 'production', NODE_ENV: 'staging' })).toBe('production');
    expect(resolveSentryEnvironment({ NODE_ENV: 'staging' })).toBe('staging');
    expect(resolveSentryEnvironment({ SENTRY_ENVIRONMENT: '  ', NODE_ENV: 'staging' })).toBe('staging');
  });

  it('release is the full SHA, never a short id', () => {
    expect(getReleaseSha({ RENDER_GIT_COMMIT: SHA40 })).toBe(SHA40);
    expect(getReleaseSha({ BUILD_ID: 'abc1234' })).toBeUndefined();
  });

  it('request bodies are never read by the Http integration', () => {
    const opts = buildSentryOptions({ SENTRY_DSN: 'x' });
    const http = (opts.integrations as Array<{ name: string }>).find((i) => i.name === 'Http');
    expect(http).toBeDefined();
    expect(opts.sendDefaultPii).toBe(false);
    expect(typeof opts.beforeSendTransaction).toBe('function');
  });

  it('the filter drops body, cookies, query, credential headers and decision keys', () => {
    const out = JSON.stringify(
      scrubSentryEvent({
        request: {
          url: `http://plot/v2/run?label=${SENTINEL}`,
          data: { nodes: [{ label: SENTINEL }] },
          cookies: { s: SENTINEL },
          query_string: `q=${SENTINEL}`,
          headers: { authorization: SENTINEL, 'x-olumi-assist-key': SENTINEL, 'x-request-id': 'CONTROL_RID' },
        },
        extra: { factor_label: SENTINEL, candidate: SENTINEL, error_code: 'any value' },
        contexts: { run: { result: SENTINEL }, runtime: { name: 'CONTROL_RUNTIME' } },
      }),
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('CONTROL_RID');
    expect(out).toContain('http://plot/v2/run');
    // extra is an allowlist: keys survive for diagnosis, values do not
    expect(out).toContain('"candidate":"[Redacted]"');
    // contexts: SDK runtime contexts kept, contexts set by code dropped
    expect(out).toContain('CONTROL_RUNTIME');
    expect(out).not.toContain('"run"');
  });

  it('queries never leave: referer, transaction name, span names and url span attributes', () => {
    const out = JSON.stringify(
      scrubSentryEvent({
        type: 'transaction',
        transaction: `POST /v2/run?label=${SENTINEL}`,
        request: { headers: { referer: `https://olumi.invalid/s/1?q=${SENTINEL}` } },
        contexts: { trace: { data: { 'url.full': `http://plot/v2/run?x=${SENTINEL}`, 'url.query': `x=${SENTINEL}` } } },
        spans: [
          {
            description: `POST http://isl/v2/robustness?label=${SENTINEL}`,
            data: { 'http.url': `http://isl/v2/robustness?label=${SENTINEL}`, 'http.query': `label=${SENTINEL}` },
          },
        ],
      } as never),
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('http://isl/v2/robustness');
    expect(out).toContain('https://olumi.invalid/s/1');
    expect(out).toContain('POST /v2/run');
  });

  it('an underivable SHA is reported as unidentified, never inferred', () => {
    const opts = buildSentryOptions({ SENTRY_DSN: 'x', SENTRY_RELEASE: '9.9.9', BUILD_ID: 'abc1234' });
    expect(opts.release).toBe('unidentified');
  });

  it('console breadcrumbs are dropped; other crumbs keep only their shape', () => {
    expect(scrubBreadcrumb({ category: 'console', message: SENTINEL })).toBeNull();
    const http = JSON.stringify(
      scrubBreadcrumb({
        category: 'http',
        message: SENTINEL,
        data: { url: `http://isl/v2/robustness?label=${SENTINEL}`, method: 'POST', status_code: 503, factor_label: SENTINEL },
      }),
    );
    expect(http).not.toContain(SENTINEL);
    expect(http).toContain('http://isl/v2/robustness');
    expect(http).toContain('503');
  });

  it('transaction span data is redacted by the key class', () => {
    const out = JSON.stringify(
      scrubSentryEvent({
        type: 'transaction',
        contexts: { trace: { data: { goal_label: SENTINEL, 'http.route': 'CONTROL_ROUTE' } } },
        spans: [{ data: { factor_label: SENTINEL, 'db.system': 'CONTROL_DB' } }],
      } as never),
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('CONTROL_ROUTE');
    expect(out).toContain('CONTROL_DB');
  });
});

describe('query-stripping regex scales linearly (regex budget)', () => {
  it.each([
    ['no query', (n: number) => 'GET http://isl/' + 'a'.repeat(n)],
    ['one long query', (n: number) => 'GET http://isl/x?' + 'b'.repeat(n)],
    ['many short queries', (n: number) => '?a '.repeat(Math.ceil(n / 3)).slice(0, n)],
  ])('%s: 20k costs < 8x of 5k', async (_shape, make) => {
    const { stripQueriesInText } = await import('../src/observability/sentry.js');
    const time = (n: number) => {
      const text = make(n);
      let best = Infinity;
      for (let i = 0; i < 5; i += 1) {
        const t0 = performance.now();
        for (let j = 0; j < 50; j += 1) stripQueriesInText(text);
        best = Math.min(best, performance.now() - t0);
      }
      return Math.max(best, 0.05);
    };
    expect(time(20_000) / time(5_000)).toBeLessThan(8);
  });
});
