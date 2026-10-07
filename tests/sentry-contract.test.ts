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
const bodySeen: boolean[] = [];

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
    // a route that CATCHES a failure and replies 500 itself (28 such sites in src/)
    app.post('/__s-h/caught', async (req, reply) => {
      const body = req.body as { nodes: Array<{ label: string }> };
      return reply.code(500).send({ code: 'INTERNAL_UNEXPECTED', message: `engine failed on ${body.nodes[0].label}` });
    });
    // code that sets extra / contexts inside the request scope
    app.post('/__s-h/ctx', async (req) => {
      const body = req.body as { nodes: Array<{ label: string }> };
      const label = body.nodes[0].label;
      Sentry.captureMessage('context probe', {
        extra: { [label]: 'anything' },
        // a field value NOT from the body (so not a registered token): only
        // the field allowlist can stop it
        contexts: {
          response: { status_code: 500, candidate: 'CTX_FIELD_MARKER_9d2' },
          otel: { candidate: 'CTX_OTEL_MARKER_4e1' },
        },
      });
      return { ok: true };
    });
    // a route whose own onSend turns a 200 into a 503 after the handler
    app.post('/__s-h/late503', {
      onSend: async (_req, reply, payload) => {
        reply.code(503);
        return payload;
      },
    }, async () => ({ ok: true }));
    // a hijacked raw 503 (the SSE rejection shape)
    app.post('/__s-h/hijack', async (_req, reply) => {
      reply.hijack();
      reply.raw.writeHead(503, { 'content-type': 'text/plain' });
      reply.raw.end('unavailable');
    });
    // a 503 that a later hook turns into a 500 (provisional status)
    app.post('/__s-h/provisional', {
      onSend: async () => {
        throw new Error('late hook failure');
      },
    }, async (_req, reply) => reply.code(503).send({ code: 'UPSTREAM_UNAVAILABLE' }));
    // what the SDK holds as the request body BEFORE any hook runs
    Sentry.addEventProcessor((event) => {
      bodySeen.push(event.request?.data !== undefined);
      return event;
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
    bodySeen.length = 0;
  });

  async function hit(path: string, status: number, headers: Record<string, string> = {}): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ nodes: [{ id: 'n1', label: SENTINEL }] }),
    });
    expect(res.status).toBe(status);
    await res.text();
    await new Promise((r) => setTimeout(r, 50));
    await Sentry.flush(2000);
    return sent.join('\n');
  }

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

  it('the SDK never holds a request body (seen by an event processor, before any hook)', async () => {
    await boom(false);
    expect(bodySeen.length).toBeGreaterThan(0);
    expect(bodySeen.every((seen) => seen === false)).toBe(true);
  });

  it('a route that catches a failure and replies 500 itself is reported once, with its code, no content', async () => {
    const wire = await hit('/__s-h/caught', 500);
    const events = sent.filter((e) => e.includes('"type":"event"'));
    expect(events.length).toBe(1);
    expect(wire).toContain('PLoT /__s-h/caught responded 500 (INTERNAL_UNEXPECTED)');
    expect(wire).toContain('"error_code":"INTERNAL_UNEXPECTED"');
    expect(wire).not.toContain(SENTINEL);
  });

  it.each([
    ['/__s-h/late503', 503, 'responded 503'],
    ['/__s-h/hijack', 503, 'responded 503'],
    ['/__s-h/provisional', 500, 'late hook failure'],
  ])('%s: the FINAL status is reported, exactly once', async (path, status, marker) => {
    const wire = await hit(path, status);
    const events = sent.filter((e) => e.includes('"type":"event"'));
    expect(events.length).toBe(1);
    expect(wire).toContain(marker);
    expect(wire).not.toContain('responded 503 (UPSTREAM_UNAVAILABLE)');
  });

  it('a caller-chosen request id that is decision content is not sent as a tag', async () => {
    const wire = await hit('/__s-h/caught', 500, { 'x-request-id': SENTINEL });
    expect(wire).toContain('"request_id":"redacted"');
    expect(wire).not.toContain(SENTINEL);
  });

  it('extra keys and context fields set in the request carry no content', async () => {
    const wire = await hit('/__s-h/ctx', 200);
    expect(wire).toContain('context probe');
    expect(wire).toContain('"redacted_extra":1');
    expect(wire).toContain('"status_code":500');
    expect(wire).not.toContain(SENTINEL);
    expect(wire).not.toContain('CTX_FIELD_MARKER_9d2');
    expect(wire).not.toContain('CTX_OTEL_MARKER_4e1');
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
          headers: {
            authorization: SENTINEL,
            'x-olumi-assist-key': SENTINEL,
            'x-decision-title': SENTINEL,
            'x-request-id': 'CONTROL_RID',
          },
        },
        extra: { factor_label: SENTINEL, candidate: SENTINEL, error_code: 'any value' },
        contexts: { run: { result: SENTINEL }, runtime: { name: 'CONTROL_RUNTIME' } },
      }),
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('CONTROL_RID');
    expect(out).toContain('http://plot/v2/run');
    // extra is an allowlist (empty in PLoT): keys can be content too, so only a count survives
    expect(out).toContain('"redacted_extra":3');
    expect(out).not.toContain('candidate');
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
            op: 'http.client',
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
    expect(out).toContain('"description":"POST http://isl/v2/robustness"');
  });

  it('transactions are never sent (errors-only service)', () => {
    const opts = buildSentryOptions({ SENTRY_DSN: 'x', SENTRY_TRACES_SAMPLE_RATE: '1' });
    expect(opts.beforeSendTransaction!({ type: 'transaction' } as never, {})).toBeNull();
  });

  it.each([
    ['sdk-default', true],
    ['contract', false],
  ])('unhandled rejection with %s: process survives = %s (contract keeps Node fatal default)', async (mode, survives) => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/_helpers/sentry-unhandled-rejection.child.ts'], {
      env: { ...process.env, CHILD_MODE: mode },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.stdout.includes('ALIVE')).toBe(survives);
    if (!survives) expect(r.status).toBe(1);
  }, 30_000);

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

  it('span data is an allowlist of SDK attributes; custom span names become their op', () => {
    const out = JSON.stringify(
      scrubSentryEvent({
        type: 'transaction',
        contexts: { trace: { data: { goal_label: SENTINEL, 'http.route': 'CONTROL_ROUTE' } } },
        spans: [
          {
            op: 'function',
            description: `child ${SENTINEL}`,
            data: { node_id: SENTINEL, candidate: SENTINEL, value: 5, 'db.system': 'CONTROL_DB' },
          },
        ],
      } as never),
    );
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain('CONTROL_ROUTE');
    expect(out).toContain('CONTROL_DB');
    expect(out).toContain('"description":"function"');
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
