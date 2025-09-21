import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { rateLimit } from './rateLimit.js';

export interface ServerOpts { enableTestRoutes?: boolean }

export async function createServer(opts: ServerOpts = {}) {
  type CacheEntry = { bodyHash: string; responseText: string; createdAt: number };
  const idemCache = new Map<string, CacheEntry>();
  const IDEM_TTL_MS = 10 * 60 * 1000;

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
  });

  await app.register(helmet, { global: true });
  if (process.env.CORS_DEV === '1') {
    await app.register(cors, { origin: 'http://localhost:5173' });
  }

  // Optional rate limit
  app.addHook('onRequest', rateLimit);

  // Minimal structured access log without bodies
  app.addHook('onRequest', async (req) => { (req as any).startTime = process.hrtime.bigint(); });
  // Echo X-Request-ID on all responses
  app.addHook('onSend', async (req, reply, payload) => {
    try { reply.header('X-Request-ID', String(req.id)); } catch {}
    return payload as any;
  });
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as any).startTime as bigint | undefined;
    const end = process.hrtime.bigint();
    const durationMs = start ? Number(end - start) / 1e6 : undefined;
    const route = (req as any)?.routeOptions?.url ?? req.url;
    if (typeof durationMs === 'number') {
      try {
        const { recordDurationMs, recordStatus } = await import('./metrics.js');
        recordDurationMs(durationMs);
        recordStatus(reply.statusCode);
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

  app.get('/version', async () => ({ api: '1.0.0', build: getBuildId(), model: 'fixtures', runtime: { node: process.version } }));

  // Liveness probe — basic process up indicator
  app.get('/live', async () => ({ ok: true }));

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
    const { errorResponse } = await import('./errors.js');
    // Map request timeouts to TIMEOUT type
    const msg = (err as any)?.message || '';
    const code = (err as any)?.code || '';
    if (code === 'FST_ERR_REQUEST_TIMEOUT' || /timeout/i.test(msg)) {
      return reply.code(504).send(errorResponse('TIMEOUT', msg || 'Request timed out', 'Reduce processing time'));
    }
    const type = msg.includes('body limit') ? 'BAD_INPUT' : 'INTERNAL';
    reply.code(type === 'INTERNAL' ? 500 : 400).send(errorResponse(type as any, msg || 'Unhandled error'));
  });

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
