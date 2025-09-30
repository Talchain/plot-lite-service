import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { readFileSync } from 'fs';
import { resolve, join as joinPath } from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { rateLimit } from './rateLimit.js';
import { replyWithAppError } from './errors.js';
export async function createServer(opts = {}) {
    const idemCache = new Map();
    const IDEM_TTL_MS = 10 * 60 * 1000;
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
        // update cache gauge
        (async () => { try {
            const { setIdemCacheSize } = await import('./metrics.js');
            setIdemCacheSize(idemCache.size);
        }
        catch { } })();
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
        if (!expected || tok !== expected) {
            await reply.code(403).send({ error: { type: 'FORBIDDEN', message: 'Invalid token' } });
            return false;
        }
        return true;
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
    // CORS: closed by default; allow only when CSV envs provided. Dev override remains.
    {
        const originsCsv = (process.env.CORS_ORIGINS || '').trim();
        if (originsCsv) {
            const allow = originsCsv.split(',').map(s => s.trim()).filter(Boolean);
            const hdrsCsv = (process.env.CORS_HEADERS || '').trim();
            const allowedHeaders = hdrsCsv ? hdrsCsv.split(',').map(s => s.trim()).filter(Boolean) : undefined;
            await app.register(cors, { origin: allow, allowedHeaders });
        }
        else if (process.env.CORS_DEV === '1') {
            await app.register(cors, { origin: 'http://localhost:5173' });
        }
    }
    // Optional rate limit (enabled by env; disabled when RATE_LIMIT_ENABLED=0)
    if (process.env.RATE_LIMIT_ENABLED !== '0') {
        app.addHook('onRequest', rateLimit);
    }
    // Minimal structured access log without bodies
    app.addHook('onRequest', async (req) => { req.startTime = process.hrtime.bigint(); });
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
                const { recordDurationMs, recordStatus, recordDraftDurationMs } = await import('./metrics.js');
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
                const { recordReplayStatus } = await import('./metrics.js');
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
        const { p95Ms, p99Ms, eventLoopDelayMs, snapshot, replaySnapshot } = await import('./metrics.js');
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
            test_routes_enabled: process.env.NODE_ENV === 'production' ? false : Boolean(opts.enableTestRoutes || process.env.TEST_ROUTES === '1'),
            replay: replaySnapshot(),
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
    app.get('/version', async () => {
        const build = getBuildId();
        return { api: 'warp/0.1.0', build, model: `plot-lite-${build}` };
    });
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
            if (containsSensitive(body)) {
                const { errorResponse } = await import('./errors.js');
                const resp = { ...errorResponse('BLOCKED_CONTENT', 'Sensitive token detected in request body; remove secrets and retry.', 'Remove secrets and retry.'), redacted: true };
                app.log.info({ reqId: req.id, route: '/draft-flows', redacted: true }, 'blocked sensitive content');
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
                purgeExpired(now);
                idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText, createdAt: now });
                try {
                    const { setIdemCacheSize } = await import('./metrics.js');
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
            if (containsSensitive(body)) {
                const { errorResponse } = await import('./errors.js');
                const resp = { ...errorResponse('BLOCKED_CONTENT', 'Sensitive token detected in request body; remove secrets and retry.', 'Remove secrets and retry.'), redacted: true };
                app.log.info({ reqId: req.id, route: '/critique', redacted: true }, 'blocked sensitive content');
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
                purgeExpired(now);
                const respText = JSON.stringify(obj);
                reply.header('Content-Type', 'application/json');
                idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText, createdAt: now });
                try {
                    const { setIdemCacheSize } = await import('./metrics.js');
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
    if (opts.enableTestRoutes || process.env.TEST_ROUTES === '1') {
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
            const { replaySnapshot } = await import('./metrics.js');
            return reply.code(200).send(replaySnapshot());
        });
        app.post('/internal/replay-report', async (req, reply) => {
            try {
                const b = req.body || {};
                const { recordReplayRefusal, recordReplayRetry, recordReplayStatus } = await import('./metrics.js');
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
                    try {
                        reply.raw.end();
                    }
                    catch { }
                    return;
                }
                // Backpressure/limit signal
                if (limitNow) {
                    writeSse(reply, '0', 'limited', { reason: 'backpressure' });
                    try {
                        reply.raw.end();
                    }
                    catch { }
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
                        try {
                            reply.raw.end();
                        }
                        catch { }
                        sseCancelled.delete(id); // idempotent cancel: clear after signalling
                        sseState.set(id, { index: seq.length });
                        return;
                    }
                    const e = seq[i];
                    await sleep(sleepMs);
                    writeSse(reply, String(i), e.ev, e.body);
                    st.index = i + 1;
                    sseState.set(id, st);
                    // Controlled dropout once at i === dropAt (if provided)
                    if (Number.isFinite(dropAt) && i === dropAt) {
                        try {
                            reply.raw.end();
                        }
                        catch { }
                        return;
                    }
                    // single forced blip after first token
                    if (blip && !st.blipped && e.ev === 'token') {
                        st.blipped = true;
                        sseState.set(id, st);
                        try {
                            reply.raw.end();
                        }
                        catch { }
                        return;
                    }
                }
                try {
                    reply.raw.end();
                }
                catch { }
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
            const { streamStarted, streamDone, streamLimited, incCurrentStreams, decCurrentStreams, noteHeartbeat } = await import('./metrics.js');
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
            const timer = setInterval(() => {
                if (closed)
                    return;
                writeComment(`ping ts=${Date.now()}`);
                try {
                    noteHeartbeat?.();
                }
                catch { }
            }, hbMs);
            const endStream = (fn) => {
                if (closed)
                    return;
                closed = true;
                clearInterval(timer);
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
            };
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
    // Dev-only: serve OpenAPI JSON when OPENAPI_DEV=1 (add-only; off by default)
    if (process.env.OPENAPI_DEV === '1') {
        app.get('/openapi.json', async (_req, reply) => {
            try {
                const { parse } = await import('yaml');
                const specPath = process.env.OPENAPI_SPEC_PATH || resolve(process.cwd(), 'contracts', 'openapi.yaml');
                const y = readFileSync(specPath, 'utf8');
                const obj = parse(y);
                reply.header('Content-Type', 'application/json');
                return reply.send(obj);
            }
            catch (e) {
                return reply.code(500).send({ error: { type: 'INTERNAL', message: e?.message || 'openapi_error' } });
            }
        });
    }
    // Metrics endpoint (flag-gated; OFF by default)
    if (process.env.METRICS === '1') {
        app.get('/metrics', async () => {
            const { getStreamCounters, getDraftP95History, getCurrentStreams, getLastHeartbeatMs } = await import('./metrics.js');
            const counters = getStreamCounters?.() || { stream_started: 0, stream_done: 0, stream_cancelled: 0, stream_limited: 0, stream_retryable: 0 };
            const last5 = getDraftP95History?.() || [];
            const current_streams = typeof getCurrentStreams === 'function' ? getCurrentStreams() : 0;
            const last_heartbeat_ms = typeof getLastHeartbeatMs === 'function' ? getLastHeartbeatMs() : 0;
            return { ...counters, current_streams, last_heartbeat_ms, draft_flows_p95_last5: last5 };
        });
    }
    // Simple global error handler mapping to typed error
    app.setErrorHandler(async (err, req, reply) => {
        // Map request timeouts to TIMEOUT type
        const emsg = err?.message || '';
        const ecode = err?.code || '';
        if (ecode === 'FST_ERR_REQUEST_TIMEOUT' || /timeout/i.test(emsg)) {
            return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time', devDetail: emsg });
        }
        const type = emsg.includes('body limit') ? 'BAD_INPUT' : 'INTERNAL';
        return replyWithAppError(reply, { type: type, statusCode: type === 'INTERNAL' ? 500 : 400, devDetail: emsg });
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
