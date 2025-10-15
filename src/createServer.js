import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { readFileSync, existsSync } from 'fs';
import { resolve, join as joinPath } from 'path';
import { spawnSync } from 'child_process';
import { createHash, timingSafeEqual } from 'crypto';
import { promises as fsp } from 'node:fs';
import { rateLimit } from './rateLimit.js';
import { refreshFromEnv } from './config/runtimeConfig.js';
import { securityHeadersOnSend } from './middleware/security-headers.js';
import { replyWithAppError } from './errors.js';
import inflightPlugin from './plugins/inflight.js';
import { noteLastRequestAt, recordDurationMs, recordStatus, recordDraftDurationMs, recordReplayStatus, recordReplayRefusal, recordReplayRetry, p95Ms, p99Ms, eventLoopDelayMs, snapshot, replaySnapshot, streamStarted, streamDone, streamLimited, incCurrentStreams, decCurrentStreams, noteHeartbeat, getStreamCounters, getDraftP95History, getCurrentStreams, getLastHeartbeatMs, setIdemCacheSize, } from './metrics.js';
export async function createServer(opts = {}) {
    const idemCache = new Map();
    const IDEM_TTL_MS = 10 * 60 * 1000;
    const IDEM_MAX_SIZE = 10;
    function getIdempotencyKey(req) {
        const h = req.headers || {};
        const k = (h['idempotency-key'] || h['Idempotency-Key']);
        return k ? String(k) : undefined;
    }
    function getCacheKey(key, bodyHash) {
        return `${key}:${bodyHash}`;
    }
    function purgeExpired(now) {
        for (const [k, v] of idemCache) {
            if (now - v.createdAt > IDEM_TTL_MS) {
                idemCache.delete(k);
            }
        }
        // Enforce LRU cap: remove oldest entries if size exceeds limit
        if (idemCache.size > IDEM_MAX_SIZE) {
            const entries = Array.from(idemCache.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);
            const toRemove = idemCache.size - IDEM_MAX_SIZE;
            for (let i = 0; i < toRemove; i++) {
                idemCache.delete(entries[i][0]);
            }
        }
        // update cache gauge
        try {
            setIdemCacheSize(idemCache.size);
        }
        catch { }
    }
    function getForcedError(req) {
        const header = req.headers['x-debug-force-error'];
        const q1 = req.query?.force_error;
        let q2;
        try {
            const u = new URL(req.url, 'http://local');
            q2 = u.searchParams.get('force_error') ?? undefined;
        }
        catch { }
        const val = (header || q1 || q2);
        return val ? String(val).toUpperCase() : undefined;
    }
    // Minimal auth helper (flag-gated)
    async function checkAuth(req, reply) {
        if (process.env.AUTH_ENABLED !== '1')
            return true;
        const hdr = String((req.headers?.authorization || req.headers?.Authorization || '') || '');
        const expected = String(process.env.AUTH_TOKEN || '').trim();
        if (!hdr.startsWith('Bearer ')) {
            try {
                reply.header('WWW-Authenticate', 'Bearer');
            }
            catch { }
            await reply.code(401).send({ error: { type: 'UNAUTHORIZED', message: 'Missing bearer token' } });
            return false;
        }
        const tok = hdr.slice('Bearer '.length).trim();
        if (!expected || tok.length !== expected.length) {
            await reply.code(403).send({ error: { type: 'FORBIDDEN', message: 'Invalid token' } });
            return false;
        }
        if (!timingSafeEqual(Buffer.from(tok), Buffer.from(expected))) {
            await reply.code(403).send({ error: { type: 'FORBIDDEN', message: 'Invalid token' } });
            return false;
        }
        return true;
    }
    // Refresh runtime tunables from current env at server creation
    try {
        refreshFromEnv();
    }
    catch { }
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
    // Guard: prevent test routes in production
    {
        const prod = process.env.NODE_ENV === 'production';
        const testRoutes = process.env.TEST_ROUTES === '1';
        if (prod && testRoutes) {
            app.log.error('TEST_ROUTES cannot be enabled in production');
            throw new Error('TEST_ROUTES cannot be enabled in production');
        }
    }
    // Register inflight plugin (self-contained: decoration + hooks)
    // Works in all entry points: main.ts, tests, tools
    await app.register(inflightPlugin);
    // Probe endpoints to read inflight counter and stats (TEST_ROUTES only, requires header)
    if (process.env.TEST_ROUTES === '1') {
        app.get('/test/inflight', async (req, reply) => {
            if (req.headers['x-test-auth'] !== '1') {
                return reply.code(403).send({ error: 'forbidden' });
            }
            reply.header('Content-Type', 'application/json; charset=utf-8');
            return { inflight: app.inflight.count() };
        });
        // Test-only: rate-limit bucket inspector
        try {
            const { __rateLimitBucketCount } = await import('./rateLimit.js');
            app.get('/__test/rl-bucket', async (req, reply) => {
                const ip = String((req.query?.ip || req.headers['x-forwarded-for'] || req.ip || '') || '');
                const method = String(req.query?.method || 'GET');
                const path = String(req.query?.path || '/draft-flows');
                const n = __rateLimitBucketCount(ip, method, path);
                return reply.code(200).send({ ip, method, path, count: n });
            });
        }
        catch { }
        app.get('/test/inflight_stats', async (req, reply) => {
            if (req.headers['x-test-auth'] !== '1') {
                return reply.code(403).send({ error: 'forbidden' });
            }
            reply.header('Content-Type', 'application/json; charset=utf-8');
            return app.inflight.stats();
        });
    }
    await app.register(helmet, {
        global: true,
        // Do not set JSON-only headers globally; our securityHeadersOnSend handles JSON paths.
        // This keeps SSE responses free from X-Content-Type-Options and Referrer-Policy etc.
        contentTypeOptions: false,
        referrerPolicy: false,
        // Disable Helmet's Cache-Control so we can set it per-route
        hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    });
    // CORS: closed by default; allow only when CSV envs provided. Dev override remains.
    {
        const originsCsv = (process.env.CORS_ORIGINS || '').trim();
        if (originsCsv) {
            const allow = originsCsv.split(',').map(s => s.trim()).filter(Boolean);
            const hdrsCsv = (process.env.CORS_HEADERS || '').trim();
            const allowedHeaders = hdrsCsv ? hdrsCsv.split(',').map(s => s.trim()).filter(Boolean) : undefined;
            // Expose rate-limit headers for browser access
            const exposedHeaders = ['Retry-After', 'X-RateLimit-Reset', 'X-RateLimit-Reason'];
            await app.register(cors, { origin: allow, allowedHeaders, exposedHeaders });
        }
        else if (process.env.CORS_DEV === '1') {
            const exposedHeaders = ['Retry-After', 'X-RateLimit-Reset', 'X-RateLimit-Reason'];
            await app.register(cors, { origin: 'http://localhost:5173', exposedHeaders });
        }
    }
    // Demo SSE endpoint (TEST_ROUTES only)
    if (process.env.TEST_ROUTES === '1') {
        app.get('/demo/stream', async (req, reply) => {
            reply.raw.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });
            const q = (req.query ?? {});
            const scenario = String(q.scenario ?? 'sch1');
            reply.raw.write(`event: hello\ndata: ${JSON.stringify({ scenario, seed: 1 })}\n\n`);
            for (const t of ['This', ' is', ' a', ' demo', ' stream.']) {
                await new Promise(r => setTimeout(r, 120));
                reply.raw.write(`event: token\ndata: ${JSON.stringify({ text: t })}\n\n`);
            }
            reply.raw.write(`event: done\ndata: {}\n\n`);
            reply.raw.end();
            return reply;
        });
    }
    // Optional rate limit (enabled by env; disabled when RATE_LIMIT_ENABLED=0)
    if (process.env.RATE_LIMIT_ENABLED !== '0') {
        app.addHook('onRequest', rateLimit);
    }
    // Minimal structured access log without bodies
    app.addHook('onRequest', async (req) => {
        req.startTime = process.hrtime.bigint();
        try {
            noteLastRequestAt();
        }
        catch { }
    });
    // Echo X-Request-ID on all responses
    app.addHook('onSend', async (req, reply, payload) => {
        try {
            reply.header('X-Request-ID', String(req.id));
        }
        catch { }
        // HSTS only in production over TLS (proxied ok via X-Forwarded-Proto)
        try {
            if (process.env.NODE_ENV === 'production') {
                const xf = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
                const proto = xf || String(req.protocol || '').toLowerCase();
                if (proto === 'https')
                    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
            }
        }
        catch { }
        return payload;
    });
    // JSON-only security headers (SSE exempt via content-type)
    app.addHook('onSend', securityHeadersOnSend);
    app.addHook('onResponse', async (req, reply) => {
        const start = req.startTime;
        const end = process.hrtime.bigint();
        const durationMs = start ? Number(end - start) / 1e6 : undefined;
        const route = req?.routeOptions?.url ?? (() => {
            try {
                return new URL(req.url, 'http://local').pathname;
            }
            catch {
                return String(req.url || '').split('?')[0];
            }
        })();
        if (typeof durationMs === 'number') {
            try {
                recordDurationMs(durationMs);
                recordStatus(reply.statusCode);
                if (route?.startsWith('/draft-flows'))
                    recordDraftDurationMs(durationMs);
            }
            catch { }
        }
        // Update replay lastStatus/lastTs for /draft-flows responses
        if (route?.startsWith('/draft-flows')) {
            try {
                const status = reply.statusCode >= 200 && reply.statusCode < 300 ? 'ok' : 'fail';
                recordReplayStatus(status);
            }
            catch { }
        }
        app.log.info({ reqId: req.id, route, statusCode: reply.statusCode, durationMs }, 'request completed');
    });
    // Load fixtures and pre-serialise for legacy POST /draft-flows
    const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
    let firstCaseResponseRaw = '';
    const caseMap = new Map();
    try {
        const fixturesText = readFileSync(fixturesPath, 'utf8');
        const fixtures = JSON.parse(fixturesText);
        if (!fixtures || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
            throw new Error('No fixtures.cases found');
        }
        for (const c of fixtures.cases) {
            if (!c.name)
                continue;
            caseMap.set(c.name, JSON.stringify(c.response));
        }
        firstCaseResponseRaw = JSON.stringify(fixtures.cases[0].response);
    }
    catch (err) {
        app.log.error({ err }, `Failed to load fixtures from ${fixturesPath}`);
        process.exit(1);
    }
    function getBuildId() {
        try {
            const res = spawnSync('git', ['--no-pager', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
            if (res.status === 0)
                return res.stdout.trim() || new Date().toISOString();
        }
        catch { }
        return new Date().toISOString();
    }
    app.get('/health', async () => {
        // Metrics already imported statically
        const { rateLimitState } = await import('./rateLimit.js');
        const mem = process.memoryUsage();
        const base = {
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
            test_routes_enabled: process.env.NODE_ENV === 'production' ? false : (process.env.TEST_ROUTES === '1'),
            replay: replaySnapshot(),
            // Dev-only documentation of defaults for CI drift checks (add-only)
            ...(process.env.NODE_ENV === 'production' ? {} : {
                flags_doc: {
                    'test_routes_enabled': false,
                    'rate_limit.enabled': true,
                }
            }),
        };
        // Enforce a small upper bound to prevent accidental drift; keep required keys
        const MAX_BYTES = 4 * 1024;
        const txt = JSON.stringify(base);
        if (Buffer.byteLength(txt, 'utf8') <= MAX_BYTES)
            return base;
        const minimal = {
            status: 'ok',
            p95_ms: p95Ms(),
            test_routes_enabled: process.env.NODE_ENV === 'production' ? false : Boolean(opts.enableTestRoutes || process.env.TEST_ROUTES === '1'),
            replay: replaySnapshot(),
        };
        return minimal;
    });
    // Root route for Render health check (returns 200 OK)
    app.get('/', async () => {
        const build = getBuildId();
        return {
            status: 'ok',
            service: 'plot-lite-engine',
            version: build,
            api: 'warp/0.1.0'
        };
    });
    app.get('/version', async () => {
        const build = getBuildId();
        return { api: 'warp/0.1.0', build, model: `plot-lite-${build}` };
    });
    // Dev OpenAPI route with strong ETag when OPENAPI_DEV=1 and file exists
    try {
        if (process.env.OPENAPI_DEV === '1') {
            app.get('/openapi.json', async (req, reply) => {
                const override = String(process.env.OPENAPI_SPEC_PATH || '').trim();
                if (override) {
                    // When override provided, return 500 if missing
                    try {
                        const abs = resolve(process.cwd(), override);
                        if (!existsSync(abs)) {
                            return reply.code(500).send({ error: { type: 'INTERNAL', message: 'OpenAPI spec override not found' } });
                        }
                        // Attempt to read and render; support .json as-is or .yaml/.yml via yaml
                        let buf;
                        if (abs.endsWith('.json')) {
                            buf = await fsp.readFile(abs);
                        }
                        else {
                            try {
                                const yaml = await import('yaml');
                                const ytxt = await fsp.readFile(abs, 'utf8');
                                const obj = yaml.parse(ytxt);
                                buf = Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
                            }
                            catch (e) {
                                return reply.code(500).send({ error: { type: 'INTERNAL', message: 'OpenAPI override parse error' } });
                            }
                        }
                        const etag = '"' + createHash('sha256').update(buf).digest('hex') + '"';
                        const inm = String(req.headers['if-none-match'] || '');
                        reply.header('Content-Type', 'application/json; charset=utf-8');
                        reply.header('Cache-Control', 'no-cache');
                        reply.header('Vary', 'If-None-Match');
                        reply.header('ETag', etag);
                        if (inm && inm === etag)
                            return reply.code(304).send();
                        return reply.code(200).send(buf);
                    }
                    catch {
                        return reply.code(500).send({ error: { type: 'INTERNAL', message: 'OpenAPI override error' } });
                    }
                }
                // Fallback: prefer artifact/openapi.json; otherwise render contracts/openapi.yaml in-process
                try {
                    const openapiJsonPath = resolve(process.cwd(), 'artifact', 'openapi.json');
                    if (existsSync(openapiJsonPath)) {
                        const buf = await fsp.readFile(openapiJsonPath);
                        const etag = '"' + createHash('sha256').update(buf).digest('hex') + '"';
                        const inm = String(req.headers['if-none-match'] || '');
                        reply.header('Content-Type', 'application/json; charset=utf-8');
                        reply.header('Cache-Control', 'no-cache');
                        reply.header('Vary', 'If-None-Match');
                        reply.header('ETag', etag);
                        if (inm && inm === etag)
                            return reply.code(304).send();
                        return reply.code(200).send(buf);
                    }
                    // Render YAML spec to JSON
                    try {
                        const yaml = await import('yaml');
                        const specPath = resolve(process.cwd(), 'contracts', 'openapi.yaml');
                        const ytxt = await fsp.readFile(specPath, 'utf8');
                        const obj = yaml.parse(ytxt);
                        const json = Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
                        const etag = '"' + createHash('sha256').update(json).digest('hex') + '"';
                        const inm = String(req.headers['if-none-match'] || '');
                        reply.header('Content-Type', 'application/json; charset=utf-8');
                        reply.header('Cache-Control', 'no-cache');
                        reply.header('Vary', 'If-None-Match');
                        reply.header('ETag', etag);
                        if (inm && inm === etag)
                            return reply.code(304).send();
                        return reply.code(200).send(json);
                    }
                    catch (e) {
                        return reply.code(404).send();
                    }
                }
                catch {
                    return reply.code(500).send({ error: { type: 'INTERNAL', message: 'openapi.json read error' } });
                }
            });
        }
    }
    catch { }
    let fixturesReady = false;
    // Readiness: only 200 when fixtures are preloaded
    app.get('/ready', async (_req, reply) => {
        return reply.code(fixturesReady ? 200 : 503).send({ ok: fixturesReady });
    });
    // Liveness probe — basic process up indicator
    app.get('/live', async () => ({ ok: true }));
    const deterministicMap = new Map();
    const deterministicRoot = resolve(process.cwd(), 'fixtures');
    async function preloadDeterministic() {
        const templates = ['pricing_change', 'feature_launch', 'build_vs_buy'];
        for (const tmpl of templates) {
            const dir = joinPath(deterministicRoot, tmpl);
            let files = [];
            try {
                const ents = await fsp.readdir(dir, { withFileTypes: true });
                files = ents.filter(e => e.isFile() && /^\d+\.json$/.test(e.name)).map(e => e.name);
            }
            catch {
                continue;
            }
            for (const f of files) {
                const seed = Number(f.replace(/\.json$/, ''));
                if (!Number.isInteger(seed))
                    continue;
                const abs = joinPath(dir, f);
                const raw = await fsp.readFile(abs);
                let parsed;
                try {
                    parsed = JSON.parse(raw.toString('utf8'));
                }
                catch (e) {
                    throw new Error(`Invalid JSON in ${abs}`);
                }
                if (parsed?.schema !== 'report.v1')
                    throw new Error(`Missing schema in ${abs}`);
                if (parsed?.meta?.seed !== seed)
                    throw new Error(`meta.seed mismatch in ${abs}`);
                const h = createHash('sha256').update(raw).digest('hex');
                const etag = '"' + h + '"';
                deterministicMap.set(`${tmpl}|${seed}`, { buf: raw, etag, contentLength: raw.length, metaSeed: seed, template: tmpl });
            }
        }
    }
    await preloadDeterministic();
    fixturesReady = true;
    app.get('/draft-flows', async (req, reply) => {
        if (!(await checkAuth(req, reply)))
            return;
        const q = req.query || {};
        const fields = {};
        const template = typeof q.template === 'string' ? q.template : '';
        const seedNum = (typeof q.seed === 'string' || typeof q.seed === 'number') ? Number(q.seed) : NaN;
        const budgetNum = q.budget == null ? null : Number(q.budget);
        const allowed = new Set(['pricing_change', 'feature_launch', 'build_vs_buy']);
        if (!allowed.has(template)) {
            return replyWithAppError(reply, {
                type: 'BAD_INPUT',
                statusCode: 404,
                key: 'INVALID_TEMPLATE',
                devDetail: { template },
            });
        }
        if (!Number.isInteger(seedNum))
            fields.seed = 'must be an integer';
        if (q.budget != null && (!Number.isInteger(budgetNum)))
            fields.budget = 'must be an integer if provided';
        if (Object.keys(fields).length > 0) {
            return replyWithAppError(reply, {
                type: 'BAD_INPUT',
                statusCode: 400,
                key: 'BAD_QUERY_PARAMS',
                hint: 'Fix invalid query parameters',
                fields,
                devDetail: fields,
            });
        }
        // Forced error injection (dev/test) for taxonomy checks
        {
            const force = getForcedError(req);
            if (force === 'TIMEOUT') {
                return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' });
            }
            if (force === 'RETRYABLE') {
                return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true });
            }
            if (force === 'INTERNAL') {
                throw new Error('Forced internal');
            }
        }
        const key = `${template}|${seedNum}`;
        const entry = deterministicMap.get(key);
        if (!entry) {
            return replyWithAppError(reply, { type: 'BAD_INPUT', statusCode: 404, key: 'INVALID_SEED', devDetail: { template, seed: seedNum } });
        }
        const inm = req.headers['if-none-match'] || '';
        reply.header('Content-Type', 'application/json');
        reply.header('Cache-Control', 'no-cache');
        reply.header('Vary', 'If-None-Match');
        reply.header('ETag', entry.etag);
        reply.header('Content-Length', String(entry.contentLength));
        if (inm && inm === entry.etag) {
            return reply.code(304).send();
        }
        return reply.send(entry.buf);
    });
    // Explicit HEAD route mirroring GET headers for parity (add-only)
    try {
        app.head('/draft-flows', async (req, reply) => {
            const q = req.query || {};
            const template = typeof q.template === 'string' ? q.template : '';
            const seedNum = (typeof q.seed === 'string' || typeof q.seed === 'number') ? Number(q.seed) : NaN;
            const allowed = new Set(['pricing_change', 'feature_launch', 'build_vs_buy']);
            if (!allowed.has(template) || !Number.isInteger(seedNum)) {
                return reply.code(400).send();
            }
            const key = `${template}|${seedNum}`;
            const entry = deterministicMap.get(key);
            if (!entry)
                return reply.code(404).send();
            reply.header('Content-Type', 'application/json');
            reply.header('Cache-Control', 'no-cache');
            reply.header('Vary', 'If-None-Match');
            reply.header('ETag', entry.etag);
            reply.header('Content-Length', String(entry.contentLength));
            return reply.code(200).send();
        });
    }
    catch (err) {
        // Swallow FST_ERR_DUPLICATED_ROUTE only; rethrow others
        if (err?.code !== 'FST_ERR_DUPLICATED_ROUTE')
            throw err;
    }
    app.post('/draft-flows', async (req, reply) => {
        if (!(await checkAuth(req, reply)))
            return;
        const body = req.body || {};
        // Test error header
        {
            const force = getForcedError(req);
            if (force === 'TIMEOUT') {
                return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' });
            }
            if (force === 'RETRYABLE') {
                return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true });
            }
            if (force === 'INTERNAL') {
                throw new Error('Forced internal');
            }
        }
        // Idempotency replay (pre-check)
        {
            const key = getIdempotencyKey(req);
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
                req.__idem = { key, bodyHash };
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
            }
            catch { }
            // Deep scan (fail closed on scanner error)
            const { containsSensitiveSafe } = await import('./lib/sensitive-safe.js');
            const scanResult = containsSensitiveSafe(body);
            if (scanResult.blocked) {
                const { errorResponse } = await import('./errors.js');
                const resp = { ...errorResponse('BLOCKED_CONTENT', 'Request blocked by content filter', 'Remove sensitive data and retry'), redacted: true };
                app.log.info({ reqId: req.id, route: '/draft-flows', redacted: true, scannerError: scanResult.scannerError }, scanResult.scannerError ? 'sensitive scan failed - blocked' : 'blocked sensitive content');
                return reply.code(400).send(resp);
            }
        }
        const seed = body?.seed;
        if (typeof seed !== 'undefined')
            app.log.info({ reqId: req.id, seed }, 'seed received');
        const fixtureCase = body?.fixture_case;
        if (fixtureCase) {
            const hit = caseMap.get(fixtureCase);
            if (!hit) {
                const { errorResponse } = await import('./errors.js');
                return reply.code(400).send(errorResponse('BAD_INPUT', `Unknown fixture_case: ${fixtureCase}`, 'Provide a valid case name from fixtures.cases[].name'));
            }
            reply.header('Content-Type', 'application/json');
            return reply.send(hit);
        }
        const respText = fixtureCase ? caseMap.get(fixtureCase) : firstCaseResponseRaw;
        reply.header('Content-Type', 'application/json');
        // Idempotency store (post)
        {
            const idem = req.__idem;
            if (idem) {
                const now = Date.now();
                idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText, createdAt: now });
                purgeExpired(now); // Purge expired and enforce LRU cap
                try {
                    setIdemCacheSize(idemCache.size);
                }
                catch { }
            }
        }
        return reply.send(respText);
    });
    app.post('/critique', async (req, reply) => {
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
            }
            catch { }
            // Deep scan (fail closed on scanner error)
            const { containsSensitiveSafe } = await import('./lib/sensitive-safe.js');
            const scanResult = containsSensitiveSafe(body);
            if (scanResult.blocked) {
                const { errorResponse } = await import('./errors.js');
                const resp = { ...errorResponse('BLOCKED_CONTENT', 'Request blocked by content filter', 'Remove sensitive data and retry'), redacted: true };
                app.log.info({ reqId: req.id, route: '/critique', redacted: true, scannerError: scanResult.scannerError }, scanResult.scannerError ? 'sensitive scan failed - blocked' : 'blocked sensitive content');
                return reply.code(400).send(resp);
            }
        }
        // Idempotency pre-check
        {
            const key = getIdempotencyKey(req);
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
                req.__idem = { key, bodyHash };
            }
        }
        // Header forced errors
        {
            const force = getForcedError(req);
            if (force === 'TIMEOUT') {
                return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' });
            }
            if (force === 'RETRYABLE') {
                return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true });
            }
            if (force === 'INTERNAL') {
                throw new Error('Forced internal');
            }
        }
        const parse_json = body.parse_json;
        if (!parse_json) {
            const { errorResponse } = await import('./errors.js');
            return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object matching flow.schema.json'));
        }
        try {
            const { validateFlowAsync } = await import('./validation.js');
            const res = await validateFlowAsync(parse_json);
            if (!res.ok) {
                const { errorResponse } = await import('./errors.js');
                return reply.code(400).send(errorResponse('BAD_INPUT', 'Invalid parse_json', res.hint));
            }
        }
        catch (e) {
            const { errorResponse } = await import('./errors.js');
            return reply.code(500).send(errorResponse('INTERNAL', 'Validator error', e?.message));
        }
        const { critiqueFlow } = await import('./critique.js');
        const obj = critiqueFlow(parse_json);
        // Idempotency store (post)
        {
            const idem = req.__idem;
            if (idem) {
                const now = Date.now();
                const respText = JSON.stringify(obj);
                reply.header('Content-Type', 'application/json');
                idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText, createdAt: now });
                purgeExpired(now); // Purge expired and enforce LRU cap
                try {
                    setIdemCacheSize(idemCache.size);
                }
                catch { }
                return reply.send(respText);
            }
        }
        return obj;
    });
    app.post('/improve', async (req, reply) => {
        const { parse_json } = req.body || {};
        if (typeof parse_json === 'undefined') {
            const { errorResponse } = await import('./errors.js');
            return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object to be echoed back'));
        }
        return { parse_json, fix_applied: [] };
    });
    // Test-only error injection and internal replay telemetry routes
    if (process.env.TEST_ROUTES === '1') {
        app.post('/__test/force-error', async (req, reply) => {
            const t = (req.body?.type || req.query?.type || '').toString().toUpperCase();
            const { errorResponse } = await import('./errors.js');
            if (t === 'TIMEOUT')
                return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' });
            if (t === 'RETRYABLE')
                return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true });
            if (t === 'INTERNAL')
                return replyWithAppError(reply, { type: 'INTERNAL', statusCode: 500, hint: 'See server logs' });
            return replyWithAppError(reply, { type: 'BAD_INPUT', statusCode: 400, message: 'Unknown type', hint: 'Use TIMEOUT, RETRYABLE, or INTERNAL' });
        });
        // Internal replay telemetry — test mode only
        app.get('/internal/replay-status', async (_req, reply) => {
            return reply.code(200).send(replaySnapshot());
        });
        app.post('/internal/replay-report', async (req, reply) => {
            try {
                const b = req.body || {};
                if (b.refusal)
                    recordReplayRefusal();
                if (b.retry)
                    recordReplayRetry();
                if (b.status === 'ok' || b.status === 'fail')
                    recordReplayStatus(b.status);
                return { ok: true };
            }
            catch {
                return { ok: false };
            }
        });
        // --- Test-only SSE streaming with resume/cancel semantics ---
        if (process.env.FEATURE_STREAM !== '1') {
            const sseState = new Map();
            const sseCancelled = new Set();
            function sleep(ms) { return new Promise(r => setTimeout(r, Math.max(0, Number(ms) || 0))); }
            function writeSse(reply, id, event, data) {
                reply.raw.write(`id: ${id}\n`);
                reply.raw.write(`event: ${event}\n`);
                reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
            }
            app.post('/stream/cancel', async (req, reply) => {
                const id = String((req.body?.id || req.query?.id || '') || '');
                if (!id)
                    return reply.code(400).send({ ok: false, error: 'id required' });
                sseCancelled.add(id);
                return { ok: true };
            });
            app.get('/stream', async (req, reply) => {
                // Hijack response for streaming
                reply.header('Content-Type', 'text/event-stream');
                reply.header('Cache-Control', 'no-cache');
                reply.header('Connection', 'keep-alive');
                reply.hijack();
                // Note: onRequest already incremented inflight
                // endStream must decrement since onResponse won't fire after hijack
                let closed = false;
                const endStream = () => {
                    if (closed)
                        return; // Idempotent: prevent double-decrement
                    closed = true;
                    // Mark as decremented to prevent onResponse from also decrementing
                    reply.raw.__inflightDecDone = true;
                    app.inflight.dec('endStream');
                    try {
                        reply.raw.end();
                    }
                    catch { }
                };
                // Handle disconnect
                reply.raw.on('close', endStream);
                reply.raw.on('error', endStream);
                const q = req.query || {};
                const id = String(q.id || 'default');
                const blip = String(q.blip || '').toLowerCase() === '1' || String(process.env.STREAM_BLIP || '') === '1';
                const limitNow = String(q.limited || '').toLowerCase() === '1';
                const sleepMs = Number(q.sleepMs || q.latency_ms || 0);
                const dropAt = (q.drop_at != null && String(q.drop_at).length > 0) ? Number(q.drop_at) : NaN;
                const fail = String(q.fail || '').toUpperCase();
                const seq = [
                    { ev: 'hello', body: { ts: new Date().toISOString() } },
                    { ev: 'token', body: { text: 'draft', index: 0 } },
                    { ev: 'cost', body: { tokens: 5, currency: 'USD', amount: 0.0 } },
                    { ev: 'done', body: { reason: 'complete' } },
                ];
                // Test-only retryable error smoke
                if (fail === 'RETRYABLE') {
                    writeSse(reply, '0', 'error', { type: 'RETRYABLE', message: 'Temporary issue', retryable: true });
                    endStream();
                    return;
                }
                // Backpressure/limit signal
                if (limitNow) {
                    writeSse(reply, '0', 'limited', { reason: 'backpressure' });
                    endStream();
                    return;
                }
                const lastIdRaw = req.headers['last-event-id'] || q.lastEventId;
                const lastId = lastIdRaw ? Number(lastIdRaw) : -1;
                const st = sseState.get(id) || { index: 0 };
                // Resume from next after last-id
                if (lastId >= 0)
                    st.index = Math.min(seq.length, lastId + 1);
                sseState.set(id, st);
                for (let i = st.index; i < seq.length; i++) {
                    // honour cancellation
                    if (sseCancelled.has(id)) {
                        writeSse(reply, String(i), 'cancelled', { reason: 'client' });
                        sseCancelled.delete(id); // idempotent cancel: clear after signalling
                        sseState.set(id, { index: seq.length });
                        endStream();
                        return;
                    }
                    const e = seq[i];
                    await sleep(sleepMs);
                    writeSse(reply, String(i), e.ev, e.body);
                    st.index = i + 1;
                    sseState.set(id, st);
                    // Controlled dropout once at i === dropAt (if provided)
                    if (Number.isFinite(dropAt) && i === dropAt) {
                        endStream();
                        return;
                    }
                    // single forced blip after first token
                    if (blip && !st.blipped && e.ev === 'token') {
                        st.blipped = true;
                        sseState.set(id, st);
                        endStream();
                        return;
                    }
                }
                endStream();
            });
        }
    }
    // --- Real SSE route (FEATURE_STREAM=1) ---
    if (process.env.FEATURE_STREAM === '1') {
        app.get('/stream', async (req, reply) => {
            // Auth gate (minimal)
            if (!(await checkAuth(req, reply)))
                return;
            // SSE headers
            reply.header('Content-Type', 'text/event-stream');
            reply.header('Cache-Control', 'no-cache');
            reply.header('Connection', 'keep-alive');
            reply.hijack();
            // Note: onRequest already incremented inflight
            // endStream must decrement since onResponse won't fire after hijack
            try {
                streamStarted?.();
            }
            catch { }
            try {
                incCurrentStreams?.();
            }
            catch { }
            const q = req.query || {};
            const forceLimit = String(process.env.STREAM_FORCE_LIMIT || '').toLowerCase() === '1';
            const sleepMs = Number(q.sleepMs || q.latency_ms || 0);
            const hbSec = Number(process.env.STREAM_HEARTBEAT_SEC || 25);
            const hbMs = Math.max(1, Math.floor(hbSec * 1000));
            function writeLine(txt) { try {
                return reply.raw.write(txt);
            }
            catch {
                return false;
            } }
            function writeComment(txt) { return writeLine(`: ${txt}\n\n`); }
            function writeSse(id, ev, data) {
                writeLine(`id: ${id}\n`);
                writeLine(`event: ${ev}\n`);
                writeLine(`data: ${JSON.stringify(data)}\n\n`);
            }
            // Heartbeat timer
            let closed = false;
            let hb;
            const endStream = (fn) => {
                if (closed)
                    return; // Idempotent: prevent double-decrement
                closed = true;
                if (hb)
                    clearInterval(hb);
                try {
                    reply.raw.end();
                }
                catch { }
                try {
                    fn?.();
                }
                catch { }
                try {
                    decCurrentStreams?.();
                }
                catch { }
                // Mark as decremented to prevent onResponse from also decrementing
                reply.raw.__inflightDecDone = true;
                // Decrement inflight (matches global onRequest increment)
                app.inflight.dec('endStream');
            };
            // Critical: Handle client disconnect to prevent timer leak and inflight counter leak
            reply.raw.on('close', () => {
                app.log.info({ reqId: req.id }, 'SSE client disconnected');
                endStream();
            });
            reply.raw.on('error', (err) => {
                app.log.error({ reqId: req.id, err }, 'SSE stream error');
                endStream();
            });
            // Leak-safe heartbeat: check socket state before writing
            hb = setInterval(() => {
                if (closed)
                    return;
                // Prevent leak: if socket destroyed or not writable, cleanup and exit
                if (reply.raw.destroyed || !reply.raw.writable) {
                    endStream();
                    return;
                }
                writeComment(`ping ts=${Date.now()}`);
                try {
                    noteHeartbeat?.();
                }
                catch { }
            }, hbMs);
            hb.unref(); // Don't keep process alive
            // Forced limited hook for deterministic testing of backpressure mapping
            if (forceLimit) {
                writeSse('0', 'limited', { reason: 'backpressure' });
                try {
                    streamLimited?.();
                }
                catch { }
                return endStream();
            }
            // Minimal sequence (hello -> token -> cost -> done) with optional latency
            const seq = [
                { ev: 'hello', body: { ts: new Date().toISOString() } },
                { ev: 'token', body: { text: 'draft', index: 0 } },
                { ev: 'cost', body: { tokens: 5, currency: 'USD', amount: 0.0 } },
                { ev: 'done', body: { reason: 'complete' } },
            ];
            const lastIdRaw = req.headers['last-event-id'] || q.lastEventId;
            let idxStart = lastIdRaw ? Math.min(seq.length, Number(lastIdRaw) + 1) : 0;
            for (let i = idxStart; i < seq.length; i++) {
                if (sleepMs > 0) {
                    await new Promise(r => setTimeout(r, sleepMs));
                }
                const e = seq[i];
                // Detect backpressure on write
                writeSse(String(i), e.ev, e.body);
                // If the socket is congested (rare in tests), map to limited and close
                const needDrain = reply.raw?.writableNeedDrain === true;
                if (needDrain) {
                    writeSse(String(i), 'limited', { reason: 'backpressure' });
                    try {
                        streamLimited?.();
                    }
                    catch { }
                    return endStream();
                }
            }
            try {
                streamDone?.();
            }
            catch { }
            return endStream();
        });
    }
    // OpenAPI dev route already registered above with ETag support
    // Metrics endpoint (flag-gated; OFF by default)
    if (process.env.METRICS === '1') {
        app.get('/metrics', async () => {
            // Metrics already imported statically
            const counters = getStreamCounters?.() || { stream_started: 0, stream_done: 0, stream_cancelled: 0, stream_limited: 0, stream_retryable: 0 };
            const last5 = getDraftP95History?.() || [];
            const current_streams = typeof getCurrentStreams === 'function' ? getCurrentStreams() : 0;
            const last_heartbeat_ms = typeof getLastHeartbeatMs === 'function' ? getLastHeartbeatMs() : 0;
            return { ...counters, current_streams, last_heartbeat_ms, draft_flows_p95_last5: last5 };
        });
    }
    // Simple global error handler mapping to typed error
    app.setErrorHandler(async (err, req, reply) => {
        const code = err?.code || '';
        const emsgRaw = err?.message || '';
        const emsg = String(emsgRaw).toLowerCase();
        // Timeouts
        if (code === 'FST_ERR_REQUEST_TIMEOUT' || /timeout/i.test(emsgRaw)) {
            return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time', devDetail: emsgRaw });
        }
        // Body too large → 413
        const isBodyTooLarge = err?.statusCode === 413
            || code.includes('BODY_TOO_LARGE')
            || emsg.includes('body limit')
            || emsg.includes('payload too large')
            || emsg.includes('too large');
        if (isBodyTooLarge) {
            return replyWithAppError(reply, { type: 'BAD_INPUT', statusCode: 413, message: 'Request entity too large' });
        }
        // Fallback INTERNAL
        const { msg } = await import('./lib/error-messages.js');
        return replyWithAppError(reply, { type: 'INTERNAL', statusCode: 500, message: msg('INTERNAL_UNEXPECTED') });
    });
    // Register /v1 routes (PLoT Engine v1 with trust signals)
    const { registerV1Routes } = await import('./routes/v1/index.js');
    await registerV1Routes(app);
    // Note: app.ready() is called by main.ts after adding inflight hooks
    // Do NOT call app.ready() here - it prevents adding hooks later
    return app;
}
