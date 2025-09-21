import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { rateLimit } from './rateLimit.js';
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
            if (now - v.createdAt > IDEM_TTL_MS)
                idemCache.delete(k);
        }
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
    app.addHook('onRequest', async (req) => { req.startTime = process.hrtime.bigint(); });
    app.addHook('onResponse', async (req, reply) => {
        const start = req.startTime;
        const end = process.hrtime.bigint();
        const durationMs = start ? Number(end - start) / 1e6 : undefined;
        const route = req?.routeOptions?.url ?? req.url;
        if (typeof durationMs === 'number') {
            try {
                const { recordDurationMs, recordStatus } = await import('./metrics.js');
                recordDurationMs(durationMs);
                recordStatus(reply.statusCode);
            }
            catch { }
        }
        app.log.info({ reqId: req.id, route, statusCode: reply.statusCode, durationMs }, 'request completed');
    });
    // Load fixtures and pre-serialise
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
        const { p95Ms, snapshot } = await import('./metrics.js');
        const { rateLimitState } = await import('./rateLimit.js');
        return { status: 'ok', p95_ms: p95Ms(), ...snapshot(), rate_limit: rateLimitState() };
    });
    app.get('/version', async () => ({ api: '1.0.0', build: getBuildId(), model: 'fixtures', runtime: { node: process.version } }));
    app.post('/draft-flows', async (req, reply) => {
        const body = req.body || {};
        // Test error header
        {
            const force = getForcedError(req);
            if (force === 'TIMEOUT') {
                const { errorResponse } = await import('./errors.js');
                return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time'));
            }
            if (force === 'RETRYABLE') {
                const { errorResponse } = await import('./errors.js');
                return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry'));
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
                const { errorResponse } = await import('./errors.js');
                return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time'));
            }
            if (force === 'RETRYABLE') {
                const { errorResponse } = await import('./errors.js');
                return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry'));
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
    // Test-only error injection
    if (opts.enableTestRoutes || process.env.TEST_ROUTES === '1') {
        app.post('/__test/force-error', async (req, reply) => {
            const t = (req.body?.type || req.query?.type || '').toString().toUpperCase();
            const { errorResponse } = await import('./errors.js');
            if (t === 'TIMEOUT')
                return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time'));
            if (t === 'RETRYABLE')
                return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry'));
            if (t === 'INTERNAL')
                return reply.code(500).send(errorResponse('INTERNAL', 'Forced internal', 'See server logs'));
            return reply.code(400).send(errorResponse('BAD_INPUT', 'Unknown type', 'Use TIMEOUT, RETRYABLE, or INTERNAL'));
        });
    }
    // Simple global error handler mapping to typed error
    app.setErrorHandler(async (err, req, reply) => {
        const { errorResponse } = await import('./errors.js');
        const type = err?.message?.includes('body limit') ? 'BAD_INPUT' : 'INTERNAL';
        reply.code(type === 'INTERNAL' ? 500 : 400).send(errorResponse(type, err?.message || 'Unhandled error'));
    });
    await app.ready();
    return app;
}
