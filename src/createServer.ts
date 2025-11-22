import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { timingSafeEqual } from 'crypto';
import { rateLimit } from './rateLimit.js';
import { parse as parseYaml } from 'yaml';
import { securityHeadersOnSend } from './middleware/security-headers.js';
import { getAllFeatureFlags } from './config/feature-flags.js';
import inflightPlugin from './plugins/inflight.js';
import { registerPrometheusMetrics } from './plugins/metrics.js';
import { initializeHistograms, observeRequestDuration } from './metrics/registry.js';

export interface ServerOpts { enableTestRoutes?: boolean }

export async function createServer(opts: ServerOpts = {}) {
  if (process.env.NODE_ENV === 'production' && (opts.enableTestRoutes || process.env.TEST_ROUTES === '1')) {
    throw new Error('TEST_ROUTES cannot be enabled in production');
  }
  type CacheEntry = { bodyHash: string; responseText: string; createdAt: number };
  const idemCache = new Map<string, CacheEntry>();
  const IDEM_TTL_MS = 10 * 60 * 1000;

  // Lightweight JSON metrics state for test-only /metrics endpoint
  let streamStarted = 0;
  let streamDone = 0;
  let streamCancelled = 0;
  let streamLimited = 0;
  let streamRetryable = 0;
  let currentStreams = 0;
  let lastHeartbeatMs = 0;
  const draftFlowsP95Last5: number[] = [];

  // Test-only stream state for /stream and /stream/cancel
  const testStreamCancelled = new Set<string>();
  const testStreamState = new Map<string, { index: number; blipped?: boolean }>();

  // Dev-only OpenAPI rate-limit counter (per-server, only used when OPENAPI_DEV=1)
  let devOpenapiCount = 0;

  function recordDraftFlowsLatency(sampleMs: number): void {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return;
    draftFlowsP95Last5.push(sampleMs);
    if (draftFlowsP95Last5.length > 5) draftFlowsP95Last5.shift();
  }

  function getIdempotencyKey(req: any): string | undefined {
    const h = req.headers || {};
    const k = (h['idempotency-key'] || h['Idempotency-Key']) as string | undefined;
    return k ? String(k) : undefined;
  }

  function getCacheKey(key: string, bodyHash: string): string {
    return `${key}:${bodyHash}`;
  }

  function purgeExpired(now: number) {
    for (const [k, v] of idemCache) {
      if (now - v.createdAt > IDEM_TTL_MS) {
        idemCache.delete(k);
      }
    }
    // update cache gauge
    (async () => { try { const { setIdemCacheSize } = await import('./metrics.js'); setIdemCacheSize(idemCache.size); } catch {} })();
  }
  function getForcedError(req: any): string | undefined {
    const header = (req.headers['x-debug-force-error'] as string | undefined);
    const q1 = (req.query as any)?.force_error as string | undefined;
    let q2: string | undefined;
    try {
      const u = new URL(req.url, 'http://local');
      q2 = u.searchParams.get('force_error') ?? undefined;
    } catch {}
    const val = (header || q1 || q2);
    return val ? String(val).toUpperCase() : undefined;
  }
  const app = Fastify({
    logger: {
      level: 'info',
      redact: { paths: ['parse_text', 'body.parse_text', 'request.body.parse_text'], remove: true },
    },
    bodyLimit: 128 * 1024,
    requestTimeout: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
    disableRequestLogging: true,
    trustProxy: process.env.TRUST_PROXY === '1',
  });

  // Register inflight tracking plugin (strict accounting, shared across all entry points)
  await app.register(inflightPlugin as any);

  // Initialize Prometheus histograms once per server when enabled
  if (process.env.PROMETHEUS_ENABLE === '1') {
    try {
      initializeHistograms();
    } catch {}
  }

  // Optional dev/test guard: prevent accidental payload or free-text logging.
  // Enabled only when NO_USER_TEXT_LOGGING=1 to avoid impacting production.
  if (process.env.NO_USER_TEXT_LOGGING === '1') {
    try {
      const { enforceNoPayloadLogging } = await import('./security/no-payload-logging.guard.js');
      (app as any).log = enforceNoPayloadLogging(app.log as any);
    } catch {}
  }

  await app.register(helmet, { global: true });
  // CORS: production allowlist (CSV or single) or dev fallback
  {
    const originsCsv = process.env.CORS_ORIGINS?.trim();
    const singleOrigin = process.env.CORS_ORIGIN?.trim();
    
    if (originsCsv) {
      // Parse comma-separated list
      const allowedOrigins = originsCsv.split(',').map(s => s.trim()).filter(Boolean);
      await app.register(cors, { origin: allowedOrigins });
    } else if (singleOrigin) {
      await app.register(cors, { origin: singleOrigin });
    } else if (process.env.CORS_DEV === '1') {
      await app.register(cors, { origin: 'http://localhost:3000' });
    }
  }

  // Optional rate limit
  app.addHook('onRequest', rateLimit);

  // Minimal structured access log without bodies and capture X-Request-Id into req.id when provided
  app.addHook('onRequest', async (req) => {
    (req as any).startTime = process.hrtime.bigint();
    try {
      const hdrs: any = (req as any).headers || {};
      const fromHeader = hdrs['x-request-id'] || hdrs['X-Request-Id'];
      if (fromHeader) {
        (req as any).id = String(fromHeader);
      }
    } catch {}
  });
  // Echo X-Request-ID on all responses (prefer client header when present)
  app.addHook('onSend', async (req, reply, payload) => {
    try {
      const hdrs: any = (req as any).headers || {};
      const fromHeader = hdrs['x-request-id'] || hdrs['X-Request-Id'];
      const id = fromHeader ? String(fromHeader) : String((req as any).id);
      if (id) {
        reply.header('X-Request-ID', id);
      }
    } catch {}
    return payload as any;
  });
  // JSON security headers (no-store for JSON, never applied to SSE)
  app.addHook('onSend', securityHeadersOnSend as any);
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as any).startTime as bigint | undefined;
    const end = process.hrtime.bigint();
    const durationMs = start ? Number(end - start) / 1e6 : undefined;
    const rawRoute = (req as any)?.routeOptions?.url ?? req.url ?? '';
    const route = String(rawRoute).split('?')[0].split('#')[0];
    if (typeof durationMs === 'number') {
      try {
        const { recordDurationMs, recordStatus } = await import('./metrics.js');
        recordDurationMs(durationMs);
        recordStatus(reply.statusCode);
      } catch {}

      try {
        if (process.env.PROMETHEUS_ENABLE === '1') {
          const method = String((req as any).method || 'GET');
          observeRequestDuration(route, method, reply.statusCode, durationMs);
        }
      } catch {}
    }
    app.log.info({ reqId: req.id, route, statusCode: reply.statusCode, durationMs }, 'request completed');
  });

  // Load fixtures and pre-serialise
  const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
  let firstCaseResponseRaw = '';
  const caseMap = new Map<string, string>();
  try {
    const fixturesText = readFileSync(fixturesPath, 'utf8');
    const fixtures = JSON.parse(fixturesText);
    if (!fixtures || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
      throw new Error('No fixtures.cases found');
    }
    for (const c of fixtures.cases) {
      if (!c.name) continue;
      caseMap.set(c.name, JSON.stringify(c.response));
    }
    firstCaseResponseRaw = JSON.stringify(fixtures.cases[0].response);
  } catch (err) {
    app.log.error({ err }, `Failed to load fixtures from ${fixturesPath}`);
    process.exit(1);
  }

  function getBuildId(): string {
    try {
      const res = spawnSync('git', ['--no-pager', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
      if (res.status === 0) return res.stdout.trim() || new Date().toISOString();
    } catch {}
    return new Date().toISOString();
  }

  app.get('/health', async () => {
    const { p95Ms, p99Ms, eventLoopDelayMs, snapshot } = await import('./metrics.js');
    const { rateLimitState } = await import('./rateLimit.js');
    const mem = process.memoryUsage();
    const resp = {
      status: 'ok',
      // Preserve legacy top-level p95 for compatibility
      p95_ms: p95Ms(),
      ...snapshot(),
      runtime: {
        node: process.version,
        uptime_s: Math.round(process.uptime()),
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        eventloop_delay_ms: eventLoopDelayMs(),
        p95_ms: p95Ms(),
        p99_ms: p99Ms(),
      },
      caches: {
        idempotency_current: idemCache.size,
      },
      rate_limit: rateLimitState(),
    };
    return resp;
  });

  app.get('/version', async () => ({
    api: '1.0.0',
    build: getBuildId(),
    model: 'fixtures',
    runtime: { node: process.version },
    flags: getAllFeatureFlags(),
  }));

  // Liveness probe — basic process up indicator
  app.get('/live', async () => ({ ok: true }));

  // JSON metrics endpoint (test-only, distinct from Prometheus /metrics)
  if (process.env.METRICS === '1' && process.env.PROMETHEUS_ENABLE !== '1') {
    app.log.info(
      { mode: 'json_metrics', path: '/metrics' },
      'Metrics: JSON /metrics endpoint enabled (Prometheus disabled)'
    );
    app.get('/metrics', async (_req, reply) => {
      reply.header('Content-Type', 'application/json; charset=utf-8');
      return {
        stream_started: streamStarted,
        // Treat done + cancelled as completed streams for mixed-cycle tests
        stream_done: streamDone + streamCancelled,
        stream_cancelled: streamCancelled,
        stream_limited: streamLimited,
        stream_retryable: streamRetryable,
        current_streams: currentStreams,
        last_heartbeat_ms: lastHeartbeatMs,
        draft_flows_p95_last5: draftFlowsP95Last5,
      };
    });
  }

  if (opts.enableTestRoutes || process.env.TEST_ROUTES === '1') {
    const requireTestAuth = (req: any): boolean => {
      const headers: any = req.headers || {};
      const raw = headers['x-test-auth'] ?? headers['X-Test-Auth'];
      return String(raw) === '1';
    };

    app.get('/test/inflight', async (req, reply) => {
      if (!requireTestAuth(req)) {
        reply.code(403).type('application/json');
        return reply.send({ error: 'forbidden' });
      }
      reply.type('application/json');
      const inflight = (app as any).inflight?.count?.() ?? 0;
      return { inflight };
    });

    app.get('/test/inflight_stats', async (req, reply) => {
      if (!requireTestAuth(req)) {
        reply.code(403).type('application/json');
        return reply.send({ error: 'forbidden' });
      }
      reply.type('application/json');
      const stats = (app as any).inflight?.stats?.() ?? { count: 0, underflows: 0 };
      return stats as any;
    });

    app.get('/demo/stream', async (req: any, reply: any) => {
      const q: any = (req as any).query || {};
      const scenario = typeof q.scenario === 'string' ? q.scenario : 'demo';

      // Basic SSE headers (no JSON security headers)
      reply.header('Content-Type', 'text/event-stream');
      reply.header('Cache-Control', 'no-cache, no-transform');
      reply.header('X-Accel-Buffering', 'no');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Connection', 'keep-alive');
      try { reply.removeHeader('X-Content-Type-Options'); } catch {}
      try { reply.removeHeader('Referrer-Policy'); } catch {}
      try { (reply.raw as any).removeHeader?.('X-Content-Type-Options'); } catch {}
      try { (reply.raw as any).removeHeader?.('Referrer-Policy'); } catch {}

      reply.hijack();
      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
          'Connection': 'keep-alive',
        });
      } catch (err) {
        reply.log?.warn?.({ err }, 'demo sse writeHead failed');
      }

      streamStarted++;
      currentStreams++;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        try {
          const inflight = (app as any).inflight;
          if (inflight && typeof inflight.dec === 'function') {
            // SSE test route manages inflight manually: mark dec done so
            // the global onResponse hook will not double-decrement.
            (reply.raw as any).__inflightDecDone = true;
            inflight.dec('endStream');
          }
        } catch {}
        streamDone++;
        if (currentStreams > 0) currentStreams--;
      };

      (req.raw as any).on('close', () => finish());
      (req.raw as any).on('error', () => finish());

      const write = (id: number, ev: string, data: unknown) => {
        reply.raw.write(`id: ${id}\n`);
        reply.raw.write(`event: ${ev}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      write(0, 'hello', { scenario });
      write(1, 'token', { text: 'This', index: 0 });
      write(2, 'done', { reason: 'complete' });

      finish();
      try { (reply.raw as any).flush?.(); } catch {}
      try { reply.raw.end(); } catch {}
      return;
    });

    app.get('/stream', async (req: any, reply: any) => {
      const headers: any = (req as any).headers || {};
      const q: any = (req as any).query || {};
      const authRequired = process.env.AUTH_ENABLED === '1' && process.env.FEATURE_STREAM === '1';
      if (authRequired) {
        const bearer = String(headers.authorization || headers.Authorization || '');
        const expected = String(process.env.AUTH_TOKEN || '').trim();
        if (!bearer.startsWith('Bearer ')) {
          reply.header('WWW-Authenticate', 'Bearer');
          reply.header('Content-Type', 'application/json; charset=utf-8');
          return reply.code(401).send({ schema: 'error.v1', code: 'UNAUTHORIZED', message: 'Missing bearer token' });
        }
        const token = bearer.slice('Bearer '.length).trim();
        const sameLength = !!expected && token.length === expected.length;
        const matches = sameLength && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
        if (!sameLength || !matches) {
          reply.header('Content-Type', 'application/json; charset=utf-8');
          return reply.code(403).send({ schema: 'error.v1', code: 'FORBIDDEN', message: 'Invalid token' });
        }
      }

      const streamId = typeof q.id === 'string' && q.id ? q.id : 'default';
      const sleepMs = Number(q.sleepMs ?? 0);
      const shouldBlip = q.blip === '1' || process.env.STREAM_BLIP === '1';
      const limitNow = q.limited === '1' || process.env.STREAM_FORCE_LIMIT === '1';
      const failMode = typeof q.fail === 'string' ? q.fail.toUpperCase() : '';
      const failRetryable = failMode === 'RETRYABLE';

      reply.header('Content-Type', 'text/event-stream; charset=utf-8');
      reply.header('Cache-Control', 'no-cache, no-transform');
      reply.header('X-Accel-Buffering', 'no');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Connection', 'keep-alive');
      try { reply.removeHeader('X-Content-Type-Options'); } catch {}
      try { reply.removeHeader('Referrer-Policy'); } catch {}
      try { (reply.raw as any).removeHeader?.('X-Content-Type-Options'); } catch {}
      try { (reply.raw as any).removeHeader?.('Referrer-Policy'); } catch {}

      reply.hijack();
      try {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
          'Connection': 'keep-alive',
        });
      } catch (err) {
        reply.log?.warn?.({ err }, 'test stream writeHead failed');
      }

      streamStarted++;
      currentStreams++;
      let finished = false;
      let heartbeat: NodeJS.Timeout | null = null;

      const finish = (reason: 'done' | 'cancelled' | 'limited' | 'retryable' | 'blip' | 'abort', opts: { preserveState?: boolean } = {}) => {
        if (finished) return;
        finished = true;
        try {
          const inflight = (app as any).inflight;
          if (inflight && typeof inflight.dec === 'function') {
            // SSE test route manages inflight manually: mark dec done so
            // the global onResponse hook will not double-decrement.
            (reply.raw as any).__inflightDecDone = true;
            inflight.dec('endStream');
          }
        } catch {}
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (!opts.preserveState) {
          testStreamState.delete(streamId);
          testStreamCancelled.delete(streamId);
        }
        if (reason === 'done') streamDone++;
        else if (reason === 'cancelled') streamCancelled++;
        else if (reason === 'limited') streamLimited++;
        else if (reason === 'retryable') streamRetryable++;
        if (currentStreams > 0) currentStreams--;
        try { (reply.raw as any).flush?.(); } catch {}
        try { reply.raw.end(); } catch {}
      };

      (req.raw as any).on('close', () => finish('abort'));
      (req.raw as any).on('error', () => finish('abort'));

      const writeEvent = (id: number | string, ev: string, data: unknown) => {
        try {
          reply.raw.write(`id: ${id}\n`);
          reply.raw.write(`event: ${ev}\n`);
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
          reply.log?.warn?.({ err }, 'test stream write failed');
          finish('abort');
        }
      };

      const sleep = async () => {
        const delay = Math.max(0, Number.isFinite(sleepMs) ? sleepMs : 0);
        if (delay > 0) {
          await new Promise<void>(resolve => setTimeout(resolve, delay));
        }
      };

      const seq = [
        { ev: 'hello', body: { ts: new Date().toISOString() } },
        { ev: 'token', body: { text: 'draft', index: 0 } },
        { ev: 'cost', body: { tokens: 5, currency: 'USD', amount: 0.0 } },
        { ev: 'done', body: { reason: 'complete' } },
      ];

      const state = testStreamState.get(streamId) || { index: 0, blipped: false };
      const headerLastId = headers['last-event-id'] ?? headers['Last-Event-ID'];
      const queryLastId = typeof q.lastEventId === 'string' ? q.lastEventId : undefined;
      const lastEventIdRaw = headerLastId ?? queryLastId;
      const lastEventId = Number(lastEventIdRaw);
      if (Number.isInteger(lastEventId) && lastEventId >= 0) {
        state.index = Math.min(seq.length, lastEventId + 1);
      }
      testStreamState.set(streamId, state);

      const heartbeatSec = Number(process.env.STREAM_HEARTBEAT_SEC || 0);
      if (heartbeatSec > 0) {
        const intervalMs = Math.max(1000, Math.floor(heartbeatSec * 1000));
        heartbeat = setInterval(() => {
          if (finished) return;
          try {
            reply.raw.write(`: ping ${Date.now()}\n\n`);
            lastHeartbeatMs = Date.now();
          } catch (err) {
            reply.log?.debug?.({ err }, 'heartbeat write failed');
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
          }
        }, intervalMs);
      }

      if (limitNow) {
        writeEvent(0, 'limited', { reason: 'backpressure' });
        finish('limited');
        return;
      }

      const run = async () => {
        for (let idx = state.index; idx < seq.length; idx++) {
          if (finished) return;
          if (testStreamCancelled.has(streamId)) {
            writeEvent(idx, 'cancelled', { reason: 'client' });
            testStreamCancelled.delete(streamId);
            finish('cancelled');
            return;
          }
          await sleep();
          if (finished) return;
          const e = seq[idx];
          writeEvent(idx, e.ev, e.body);
          state.index = idx + 1;
          testStreamState.set(streamId, state);
          if (failRetryable && e.ev === 'token') {
            await sleep();
            if (!finished) {
              writeEvent(idx + 1, 'error', { type: 'RETRYABLE' });
              finish('retryable');
            }
            return;
          }
          if (shouldBlip && !state.blipped && e.ev === 'token') {
            state.blipped = true;
            testStreamState.set(streamId, state);
            finish('blip', { preserveState: true });
            return;
          }
        }
        finish('done');
      };

      run().catch(err => {
        reply.log?.error?.({ err }, 'test stream run failed');
        finish('abort');
      });

      return;
    });

    app.post('/stream/cancel', async (req: any, reply: any) => {
      let id = '';
      try {
        const body: any = (req as any).body;
        if (body && typeof body.id === 'string') id = String(body.id);
      } catch {}

      if (!id) {
        const q: any = (req as any).query || {};
        if (typeof q.id === 'string') id = String(q.id);
      }

      if (id) testStreamCancelled.add(id);

      reply.header('Content-Type', 'application/json; charset=utf-8');
      return { ok: true };
    });
  }

  // Fixture-backed GET/HEAD /draft-flows with strict GET↔HEAD parity
  app.route({
    method: ['GET', 'HEAD'],
    url: '/draft-flows',
    async handler(req: any, reply: any) {
      const t0 = process.hrtime.bigint();
      const q: any = (req as any).query || {};
      const template = typeof q.template === 'string' ? q.template : '';
      const rawSeed = q.seed;

      // Forced error injection for taxonomy tests
      {
        const force = getForcedError(req as any);
        if (force === 'TIMEOUT' || force === 'RETRYABLE' || force === 'INTERNAL') {
          const [{ errorResponse }, { ERR_MSG }] = await Promise.all([
            import('./errors.js'),
            import('./lib/error-messages.js'),
          ]);
          if (force === 'TIMEOUT') {
            return reply.code(504).send(errorResponse('TIMEOUT', ERR_MSG.TIMEOUT_UPSTREAM));
          }
          if (force === 'RETRYABLE') {
            return reply.code(503).send(errorResponse('RETRYABLE', ERR_MSG.RETRYABLE_UPSTREAM));
          }
          if (force === 'INTERNAL') {
            return reply.code(500).send(errorResponse('INTERNAL', ERR_MSG.INTERNAL_UNEXPECTED));
          }
        }
      }

      // Validate query params
      if (!template) {
        const [{ errorResponse }, { ERR_MSG }] = await Promise.all([
          import('./errors.js'),
          import('./lib/error-messages.js'),
        ]);
        const payload: any = errorResponse('BAD_INPUT', ERR_MSG.BAD_QUERY_PARAMS);
        (payload as any).error.fields = { template: 'template is required' };
        return reply.code(400).send(payload);
      }

      const seedNum = Number(rawSeed);
      if (!Number.isInteger(seedNum)) {
        const [{ errorResponse }, { ERR_MSG }] = await Promise.all([
          import('./errors.js'),
          import('./lib/error-messages.js'),
        ]);
        const payload: any = errorResponse('BAD_INPUT', ERR_MSG.BAD_QUERY_PARAMS);
        (payload as any).error.fields = { seed: 'seed must be an integer' };
        return reply.code(400).send(payload);
      }

      // Resolve fixture path
      const fixturesRoot = resolve(process.cwd(), 'fixtures');
      const templateDir = resolve(fixturesRoot, template);
      if (!existsSync(templateDir)) {
        const [{ errorResponse }, { ERR_MSG }] = await Promise.all([
          import('./errors.js'),
          import('./lib/error-messages.js'),
        ]);
        return reply.code(404).send(errorResponse('BAD_INPUT', ERR_MSG.INVALID_TEMPLATE));
      }

      const filePath = resolve(templateDir, `${seedNum}.json`);
      if (!existsSync(filePath)) {
        const [{ errorResponse }, { ERR_MSG }] = await Promise.all([
          import('./errors.js'),
          import('./lib/error-messages.js'),
        ]);
        return reply.code(404).send(errorResponse('BAD_INPUT', ERR_MSG.INVALID_SEED));
      }

      // Strong ETag + caching headers
      const etag = `"draft-flows:${template}:${seedNum}"`;
      const headers: any = (req as any).headers || {};
      const ifNoneMatch = (headers['if-none-match'] || headers['If-None-Match']) as string | undefined;
      reply.header('ETag', etag);
      reply.header('Vary', 'If-None-Match');
      reply.header('Cache-Control', 'no-cache');

      if (ifNoneMatch && ifNoneMatch === etag) {
        return reply.code(304).send();
      }

      const body = readFileSync(filePath, 'utf8');
      const len = Buffer.byteLength(body, 'utf8');
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Length', String(len));

      if ((req as any).method === 'HEAD') {
        return reply.code(200).send();
      }

      try {
        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6;
        recordDraftFlowsLatency(ms);
      } catch {}

      return reply.code(200).send(body);
    },
  });

  app.post('/draft-flows', async (req, reply) => {
    const body: any = (req as any).body || {};
    // Test error header
    {
      const force = getForcedError(req as any);
      if (force === 'TIMEOUT') { const { errorResponse } = await import('./errors.js'); return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time')); }
      if (force === 'RETRYABLE') { const { errorResponse } = await import('./errors.js'); return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry')); }
      if (force === 'INTERNAL') { throw new Error('Forced internal'); }
    }
    // Idempotency replay (pre-check)
    {
      const key = getIdempotencyKey(req as any);
      if (key) {
        const now = Date.now();
        purgeExpired(now);
        const { canonicalStringify, sha256Hex } = await import('./util/canonical.js');
        const bodyHash = sha256Hex(canonicalStringify(body));
        // Search any existing entry for same key regardless of body to detect mismatch
        for (const [k, entry] of idemCache) {
          if (k.startsWith(`${key}:`)) {
            if (entry.bodyHash !== bodyHash && now - entry.createdAt <= IDEM_TTL_MS) {
              const { errorResponse } = await import('./errors.js');
              return reply.code(400).send(errorResponse('BAD_INPUT', 'Idempotency key already used with different body', 'Use a new Idempotency-Key or the same exact body'));
            }
          }
        }
        const cacheKey = getCacheKey(key, bodyHash);
        const entry = idemCache.get(cacheKey);
        if (entry && now - entry.createdAt <= IDEM_TTL_MS) {
          reply.header('Content-Type', 'application/json');
          return reply.send(entry.responseText);
        }
        (req as any).__idem = { key, bodyHash };
      }
    }

    // Sensitive scan (fast path then deep)
    {
      const { containsSensitive } = await import('./lib/sensitive.js');
      try {
        const raw = JSON.stringify(body).toLowerCase();
        if (raw.includes('password') || raw.includes('passwd') || raw.includes('api_key') || raw.includes('apikey') || raw.includes('authorization') || raw.includes('bearer ') || raw.includes('secret') || raw.includes('private_key') || raw.includes('ssn')) {
          const { errorResponse } = await import('./errors.js');
          const resp = { ...errorResponse('BLOCKED_CONTENT', 'Sensitive token detected in request body; remove secrets and retry.', 'Remove secrets and retry.'), redacted: true };
          app.log.info({ reqId: req.id, route: '/draft-flows', redacted: true }, 'blocked sensitive content');
          return reply.code(400).send(resp);
        }
      } catch {}
      if (containsSensitive(body)) {
        const { errorResponse } = await import('./errors.js');
        const resp = { ...errorResponse('BLOCKED_CONTENT', 'Sensitive token detected in request body; remove secrets and retry.', 'Remove secrets and retry.'), redacted: true };
        app.log.info({ reqId: req.id, route: '/draft-flows', redacted: true }, 'blocked sensitive content');
        return reply.code(400).send(resp);
      }
    }
    const seed = body?.seed;
    if (typeof seed !== 'undefined') app.log.info({ reqId: req.id, seed }, 'seed received');
    const fixtureCase = body?.fixture_case as string | undefined;
    if (fixtureCase) {
      const hit = caseMap.get(fixtureCase);
      if (!hit) { const { errorResponse } = await import('./errors.js'); return reply.code(400).send(errorResponse('BAD_INPUT', `Unknown fixture_case: ${fixtureCase}`, 'Provide a valid case name from fixtures.cases[].name')); }
      reply.header('Content-Type', 'application/json');
      return reply.send(hit);
    }
    const respText = fixtureCase ? (caseMap.get(fixtureCase) as string) : firstCaseResponseRaw;
    reply.header('Content-Type', 'application/json');

    // Idempotency store (post)
    {
      const idem = (req as any).__idem as { key: string; bodyHash: string } | undefined;
      if (idem) {
        const now = Date.now();
        purgeExpired(now);
        idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText, createdAt: now });
        try { const { setIdemCacheSize } = await import('./metrics.js'); setIdemCacheSize(idemCache.size); } catch {}
      }
    }

    return reply.send(respText);
  });

  app.post('/critique', async (req: any, reply) => {
    const body = req.body || {};
    // Sensitive scan (fast path then deep)
    {
      const { containsSensitive } = await import('./lib/sensitive.js');
      try {
        const raw = JSON.stringify(body).toLowerCase();
        if (raw.includes('password') || raw.includes('passwd') || raw.includes('api_key') || raw.includes('apikey') || raw.includes('authorization') || raw.includes('bearer ') || raw.includes('secret') || raw.includes('private_key') || raw.includes('ssn')) {
          const { errorResponse } = await import('./errors.js');
          const resp = { ...errorResponse('BLOCKED_CONTENT', 'Sensitive token detected in request body; remove secrets and retry.', 'Remove secrets and retry.'), redacted: true };
          app.log.info({ reqId: req.id, route: '/critique', redacted: true }, 'blocked sensitive content');
          return reply.code(400).send(resp);
        }
      } catch {}
      if (containsSensitive(body)) {
        const { errorResponse } = await import('./errors.js');
        const resp = { ...errorResponse('BLOCKED_CONTENT', 'Sensitive token detected in request body; remove secrets and retry.', 'Remove secrets and retry.'), redacted: true };
        app.log.info({ reqId: req.id, route: '/critique', redacted: true }, 'blocked sensitive content');
        return reply.code(400).send(resp);
      }
    }
    // Idempotency pre-check
    {
      const key = getIdempotencyKey(req as any);
      if (key) {
        const now = Date.now();
        purgeExpired(now);
        const { canonicalStringify, sha256Hex } = await import('./util/canonical.js');
        const bodyHash = sha256Hex(canonicalStringify(body));
        for (const [k, entry] of idemCache) {
          if (k.startsWith(`${key}:`)) {
            if (entry.bodyHash !== bodyHash && now - entry.createdAt <= IDEM_TTL_MS) {
              const { errorResponse } = await import('./errors.js');
              return reply.code(400).send(errorResponse('BAD_INPUT', 'Idempotency key already used with different body', 'Use a new Idempotency-Key or the same exact body'));
            }
          }
        }
        const cacheKey = getCacheKey(key, bodyHash);
        const entry = idemCache.get(cacheKey);
        if (entry && now - entry.createdAt <= IDEM_TTL_MS) {
          reply.header('Content-Type', 'application/json');
          return reply.send(entry.responseText);
        }
        (req as any).__idem = { key, bodyHash };
      }
    }

    // Header forced errors
    {
      const force = getForcedError(req as any);
      if (force === 'TIMEOUT') { const { errorResponse } = await import('./errors.js'); return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time')); }
      if (force === 'RETRYABLE') { const { errorResponse } = await import('./errors.js'); return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry')); }
      if (force === 'INTERNAL') { throw new Error('Forced internal'); }
    }
    const parse_json = body.parse_json;
    if (!parse_json) { const { errorResponse } = await import('./errors.js'); return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object matching flow.schema.json')); }
    try {
      const { validateFlowAsync } = await import('./validation.js');
      const res = await validateFlowAsync(parse_json);
      if (!res.ok) { const { errorResponse } = await import('./errors.js'); return reply.code(400).send(errorResponse('BAD_INPUT', 'Invalid parse_json', res.hint)); }
    } catch (e: any) { const { errorResponse } = await import('./errors.js'); return reply.code(500).send(errorResponse('INTERNAL', 'Validator error', e?.message)); }
    const { critiqueFlow } = await import('./critique.js');
    const obj = critiqueFlow(parse_json);

    // Idempotency store (post)
    {
      const idem = (req as any).__idem as { key: string; bodyHash: string } | undefined;
      if (idem) {
        const now = Date.now();
        purgeExpired(now);
        const respText = JSON.stringify(obj);
        reply.header('Content-Type', 'application/json');
        idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText, createdAt: now });
        try { const { setIdemCacheSize } = await import('./metrics.js'); setIdemCacheSize(idemCache.size); } catch {}
        return reply.send(respText);
      }
    }

    return obj;
  });

  app.post('/improve', async (req: any, reply) => {
    const { parse_json } = req.body || {};
    if (typeof parse_json === 'undefined') { const { errorResponse } = await import('./errors.js'); return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object to be echoed back')); }
    return { parse_json, fix_applied: [] };
  });

  // Register PLoT Engine v1 routes under /v1/*
  {
    const { registerV1Routes } = await import('./routes/v1/index.js');
    await registerV1Routes(app as any);
  }

  // Register Prometheus /metrics endpoint (internally gated by PROMETHEUS_ENABLE)
  await registerPrometheusMetrics(app as any);

  // Test-only error injection
  if (opts.enableTestRoutes || process.env.TEST_ROUTES === '1') {
    app.post('/__test/force-error', async (req: any, reply) => {
      const t = (req.body?.type || req.query?.type || '').toString().toUpperCase();
      const { errorResponse } = await import('./errors.js');
      if (t === 'TIMEOUT') return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time'));
      if (t === 'RETRYABLE') return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry'));
      if (t === 'INTERNAL') return reply.code(500).send(errorResponse('INTERNAL', 'Forced internal', 'See server logs'));
      return reply.code(400).send(errorResponse('BAD_INPUT', 'Unknown type', 'Use TIMEOUT, RETRYABLE, or INTERNAL'));
    });
  }

  // Simple global error handler mapping to typed error
  app.setErrorHandler(async (err, req, reply) => {
    if ((reply as any).sent || (reply.raw as any)?.headersSent) {
      try { (req as any).log?.error?.({ err }, 'error after response sent'); } catch {}
      return;
    }

    const rawRoute = ((req as any)?.routeOptions?.url ?? (req as any)?.url ?? 'unknown') as string;
    const route = String(rawRoute).split('?')[0].split('#')[0];

    if ((err as any)?.validation) {
      try {
        const { incValidationError } = await import('./observability/validationMetrics.js');
        incValidationError(route, 'request', 'ajv');
      } catch {}

      try {
        const { formatValidationErrors } = await import('./middleware/input-validation.js');
        const payload = formatValidationErrors(((err as any).validation) || []);
        const status = Number.isInteger((err as any).statusCode) ? (err as any).statusCode : 400;
        await reply.code(status).send(payload);
        return;
      } catch {}
    }

    const msg = (err as any)?.message || '';
    const code = (err as any)?.code || '';

    if (code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      const message = 'Request body is not valid JSON';
      const payload: any = {
        schema: 'error.v1',
        code: 'BAD_INPUT',
        message,
        field: 'body',
        hint: 'Provide a valid JSON body with Content-Type: application/json',
        path: ['/body']
      };
      try { payload.error = { type: 'BAD_INPUT', message }; } catch {}
      await reply.code(400).send(payload);
      return;
    }

    const { errorResponse } = await import('./errors.js');

    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE' || /body limit/i.test(msg)) {
      await reply
        .code(413)
        .send(errorResponse('BAD_INPUT', msg || 'Request body too large', 'Reduce request size to advertised limits'));
      return;
    }

    if (code === 'FST_ERR_REQUEST_TIMEOUT' || /timeout/i.test(msg)) {
      await reply.code(504).send(errorResponse('TIMEOUT', msg || 'Request timed out', 'Reduce processing time'));
      return;
    }

    await reply.code(500).send(errorResponse('INTERNAL', msg || 'Unhandled error'));
  });

// Serve OpenAPI specification for v1 clients
app.get('/v1/openapi.json', async (_req, reply) => {
  try {
    const specPath = process.env.OPENAPI_SPEC_PATH || resolve(process.cwd(), 'contracts', 'openapi.yaml');
    const txt = readFileSync(specPath, 'utf8');
    const doc = parseYaml(txt);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    return reply.send(doc as any);
  } catch (err: any) {
    try {
      const { errorResponse } = await import('./errors.js');
      return reply.code(500).send(errorResponse('INTERNAL', 'Failed to load OpenAPI spec', err?.message || ''));
    } catch {
      return reply.code(500).send({ error: { type: 'INTERNAL', message: 'Failed to load OpenAPI spec' } });
    }
  }
});

  // Dev-only /openapi.json route with strong ETag and 304 handling
  if (process.env.OPENAPI_DEV === '1') {
    const devOpenapiEtag = '"openapi-spec-v1"';

    app.get('/openapi.json', async (req, reply) => {
      const ifNoneMatch = (req.headers['if-none-match'] || req.headers['If-None-Match']) as string | undefined;
      reply.header('ETag', devOpenapiEtag);
      reply.header('Vary', 'If-None-Match');
      // Ensure dev OpenAPI route has a Cache-Control header (helmet-compatible)
      if (!reply.getHeader('Cache-Control')) {
        reply.header('Cache-Control', 'no-store');
      }

      if (ifNoneMatch && ifNoneMatch === devOpenapiEtag) {
        return reply.code(304).send();
      }

      // Simple per-server dev rate limit: allow first 10 requests, then 429 with Retry-After
      if (devOpenapiCount >= 10) {
        reply.header('Retry-After', '60');
        return reply.code(429).send();
      }
      devOpenapiCount++;

      try {
        const specPath = process.env.OPENAPI_SPEC_PATH || resolve(process.cwd(), 'contracts', 'openapi.yaml');
        const txt = readFileSync(specPath, 'utf8');
        const doc = parseYaml(txt);
        reply.header('Content-Type', 'application/json; charset=utf-8');
        return reply.send(doc as any);
      } catch (err: any) {
        try {
          const { errorResponse } = await import('./errors.js');
          return reply.code(500).send(errorResponse('INTERNAL', 'Failed to load OpenAPI spec', err?.message || ''));
        } catch {
          return reply.code(500).send({ error: { type: 'INTERNAL', message: 'Failed to load OpenAPI spec' } });
        }
      }
    });
  }

  // Optional ops snapshot endpoint
  if (process.env.OPS_SNAPSHOT === '1') {
    app.get('/ops/snapshot', async () => {
      const { p95Ms, p99Ms, eventLoopDelayMs, snapshot } = await import('./metrics.js');
      const { rateLimitState } = await import('./rateLimit.js');
      const mem = process.memoryUsage();
      return {
        status: 'ok',
        p95_ms: p95Ms(),
        ...snapshot(),
        runtime: {
          node: process.version,
          uptime_s: Math.round(process.uptime()),
          rss_mb: Math.round(mem.rss / 1024 / 1024),
          heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
          eventloop_delay_ms: eventLoopDelayMs(),
          p95_ms: p95Ms(),
          p99_ms: p99Ms(),
        },
        caches: { idempotency_current: idemCache.size },
        rate_limit: rateLimitState(),
      };
    });
  }

  await app.ready();
  return app;
}
