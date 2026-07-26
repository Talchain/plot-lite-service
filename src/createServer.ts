import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { existsSync } from 'fs';
import { resolve, join as joinPath } from 'path';
import { createHash, randomUUID } from 'crypto';
import { promises as fsp } from 'node:fs';
import { redactLogRecord, redactLogArgs, installConsoleBoundary } from './logging/log-boundary.js';
import { beginDecisionTokenScope, registerDecisionTokens } from './logging/decision-tokens.js';
import { makeRateLimiter } from './middleware/rate-limit.js';
import { refreshFromEnv } from './config/runtimeConfig.js';
import { securityHeadersOnSend } from './middleware/security-headers.js';
import { replyWithAppError } from './errors.js';
import { authGuard } from './middleware/auth-guard.js';
import { sanitizeUrl } from './lib/log-sanitizer.js';
import inflightPlugin from './plugins/inflight.js';
import type {} from './types/fastify.js';
import { FASTIFY_REQUEST_TIMEOUT_MS } from './config/timeouts.js';
import { registerHealthRoutes } from './routes/health.js';
import { getBuildId } from './util/build-id.js';
import { computeOlumiHash } from './util/canonical.js';
import { initDownstreamTracking, clearDownstreamTracking, formatDownstreamHeader, getDownstreamCallsForBoundaryLog } from './util/downstream-tracker.js';
import { recordPayloadHashInvalid } from './metrics/registry.js';
import {
  noteLastRequestAt,
  recordDurationMs,
  recordStatus,
  recordDraftDurationMs,
  recordReplayStatus,
  recordReplayRefusal,
  recordReplayRetry,
  streamStarted,
  streamDone,
  streamLimited,
  incCurrentStreams,
  decCurrentStreams,
  noteHeartbeat,
  getStreamCounters,
  getDraftP95History,
  getCurrentStreams,
  getLastHeartbeatMs,
  setIdemCacheSize,
  replaySnapshot,
} from './metrics.js';

export interface ServerOpts { enableTestRoutes?: boolean }

export async function createServer(opts: ServerOpts = {}) {
  // P0: Validate HMAC secrets (fail-fast)
  const { validateHMACSecrets, validateExternalServiceURLs, validateDemoModeDisabled } = await import('./config/secret-validation.js');
  validateHMACSecrets();
  validateExternalServiceURLs();
  validateDemoModeDisabled();

  // Validate feature flags on boot
  const { validateFeatureFlags } = await import('./config/feature-flags.js');
  validateFeatureFlags();

  const { FLAGS: _bootFlags } = await import('./config/flags.js');

  // Bounded idempotency cache (C1)
  const { BoundedLRU } = await import('./lib/BoundedLRU.js');
  const { PrincipalQuotas } = await import('./lib/PrincipalQuotas.js');
  const { extractPrincipal } = await import('./lib/token-principal.js');
  type CacheEntry = { bodyHash: string; responseText: string };
  const idemCache = new BoundedLRU<CacheEntry>({
    maxSize: 5000,
    ttlMs: 10 * 60 * 1000,
  });
  const principalQuotas = new PrincipalQuotas({ maxKeysPerPrincipal: 100 });

  // Lightweight JSON metrics state for test-only /metrics endpoint
  let jsonStreamStarted = 0;
  let jsonStreamDone = 0;
  let jsonStreamCancelled = 0;
  let jsonStreamLimited = 0;
  let jsonStreamRetryable = 0;
  let jsonCurrentStreams = 0;
  let jsonLastHeartbeatMs = 0;
  const draftFlowsP95Last5: number[] = [];

  // Test-only stream state for /stream and /stream/cancel
  const testStreamCancelled = new Set<string>();
  const testStreamState = new Map<string, { index: number; blipped?: boolean }>();

  // Dev-only OpenAPI limiter state (per-server, only used when OPENAPI_DEV=1)
  const DEV_OPENAPI_WINDOW_MS = 60 * 1000;
  const DEV_OPENAPI_LIMIT = 10;
  const devOpenapiHits = new Map<string, { count: number; resetAt: number }>();
  let lastDevOpenapiPrune = 0;

  const allowForcedErrors =
    process.env.DEBUG_FORCE_ERROR === '1' ||
    process.env.DEBUG_FORCE_ERROR_ENABLE === '1' ||
    process.env.TEST_ROUTES === '1' ||
    process.env.NODE_ENV === 'test';

  function _recordDraftFlowsLatency(sampleMs: number): void {
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

  function getForcedError(req: any): string | undefined {
    if (!allowForcedErrors) return undefined;
    const header = (req.headers['x-debug-force-error'] as string | undefined);
    const q1 = (req.query as any)?.force_error as string | undefined;
    let q2: string | undefined;
    try {
      const u = new URL(req.url, 'http://local');
      q2 = u.searchParams.get('force_error') ?? undefined;
    } catch (err) {
      req.log?.debug?.({
        evt: 'url_parse_failed',
        err,
        url: sanitizeUrl(req.url),
        feature: 'debug-force-error'
      }, '[debug-force-error] Failed to parse URL for force_error param');
    }
    const val = (header || q1 || q2);
    return val ? String(val).toUpperCase() : undefined;
  }

  function pruneDevOpenapiHits(now: number) {
    if (now - lastDevOpenapiPrune < DEV_OPENAPI_WINDOW_MS) return;
    lastDevOpenapiPrune = now;
    for (const [key, bucket] of devOpenapiHits) {
      if (bucket.resetAt <= now) {
        devOpenapiHits.delete(key);
      }
    }
  }

  function consumeDevOpenapiSlot(req: any, now: number): number | null {
    const forwarded = req?.headers?.['x-forwarded-for'] as string | string[] | undefined;
    const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ipFromHeader = forwardedIp ? forwardedIp.split(',')[0]?.trim() : '';
    const ip = ipFromHeader || (req.ip ? String(req.ip) : '') || 'unknown';
    const key = ip;
    pruneDevOpenapiHits(now);
    let bucket = devOpenapiHits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + DEV_OPENAPI_WINDOW_MS };
    }
    bucket.count += 1;
    devOpenapiHits.set(key, bucket);
    if (bucket.count > DEV_OPENAPI_LIMIT) {
      // Normalized Retry-After: always advertise the full window length in seconds
      return Math.max(1, Math.ceil(DEV_OPENAPI_WINDOW_MS / 1000));
    }
    return null;
  }
  // Auth helper - uses consolidated middleware from auth-guard.ts
  // Refresh runtime tunables from current env at server creation
  try {
    refreshFromEnv();
  } catch (err) {
    // Non-fatal: server continues with default config values
    console.error(JSON.stringify({
      evt: 'runtime_config_refresh_failed',
      level: 'error',
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
      context: 'server_startup'
    }));
  }

  // P1: Initialize Prometheus histograms (flag-gated)
  const { initializeHistograms } = await import('./metrics/registry.js');
  initializeHistograms();

  const app = Fastify({
    logger: {
      level: 'info',
      redact: { paths: ['parse_text', 'body.parse_text', 'request.body.parse_text'], remove: true },
      // Wave1-L1 THE logger boundary. formatters.log fires for the root logger
      // AND every child — `req.log`, and the bare `logger?.` params that are
      // `req.log` passed down — so a new log site is redacted by DEFAULT,
      // without its author wrapping anything. This replaces per-call-site
      // edits, which took three review rounds and still leaked (ROADMAP 2.56).
      // No-op outside a request scope, so boot/tool logs are unchanged.
      //
      // BOTH hooks are required. formatters.log sees the merged object and
      // child bindings but NOT `msg`; logMethod sees the raw args (so it covers
      // `msg` in both `info(obj, 'text')` and `info('text')` shapes) but not
      // bindings. Either alone leaves a hole. Redaction is idempotent, so the
      // double pass is safe.
      formatters: { log: redactLogRecord },
      hooks: {
        logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void) {
          return (method as (...a: unknown[]) => void).apply(this, redactLogArgs(args));
        },
      },
    },
    bodyLimit: 128 * 1024,
    // F-64: requestTimeout must exceed longest downstream proxy timeout (CEE_PROXY_TIMEOUT_MS=135s).
    // Chain: CEE LLM call < CEE route timeout < PLoT proxy timeout < Fastify requestTimeout < Render gateway.
    requestTimeout: FASTIFY_REQUEST_TIMEOUT_MS,
    disableRequestLogging: true,
    trustProxy: process.env.TRUST_PROXY === '1',
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      if (header && typeof header === 'string' && header.trim()) {
        return header.trim();
      }
      return randomUUID();
    },
  });

  // Optional dev/test guard: prevent accidental payload or free-text logging.
  // Enabled only when NO_USER_TEXT_LOGGING=1 to avoid impacting production.
  if (process.env.NO_USER_TEXT_LOGGING === '1') {
    try {
      const { enforceNoPayloadLogging } = await import('./security/no-payload-logging.guard.js');
      (app as any).log = enforceNoPayloadLogging(app.log as any);
    } catch { /* ignore */ }
  }

  // Log key feature flag states for ops verification
  app.log.info({
    event: 'feature_flags_boot',
    ENABLE_VALIDATE_PATCH: _bootFlags.ENABLE_VALIDATE_PATCH,
    ENABLE_FACTS_ASSEMBLY: _bootFlags.ENABLE_FACTS_ASSEMBLY,
    ENABLE_REVIEW_PASS: _bootFlags.ENABLE_REVIEW_PASS,
  });

  // Wave1-L1 logger boundary, arm 2: console.* bypasses pino entirely (86 sites,
  // e.g. v2/run.ts:579 leaking a raw node id). Installed once, idempotent.
  installConsoleBoundary();

  // Wave1-L1 logger boundary: establish the request's decision-token scope.
  //
  // onRequest runs before body parsing, so the scope exists for the WHOLE
  // request (including parse/validation failures, which is exactly where the
  // validator prose that interpolates raw node ids gets logged). enterWith
  // propagates it to every downstream async continuation; verified isolated
  // per request against a live server (see beginDecisionTokenScope).
  app.addHook('onRequest', async () => {
    beginDecisionTokenScope();
  });

  // Harvest the decision content once the body is parsed. preValidation is the
  // earliest hook with req.body populated; registering here means every log
  // line emitted from validation onward is scrubbed against this request's own
  // labels, ids and values — whatever key some future author puts them under.
  app.addHook('preValidation', async (request) => {
    try {
      registerDecisionTokens(request.body);
    } catch {
      /* harvesting must never fail a request */
    }
  });

  // Echo X-Request-Id back to client
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
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

  // Log backend selection
  {
    const { logBackendSelection } = await import('./config/backend.js');
    logBackendSelection(app.log);
  }

  // Initialize artifact directory and health counters
  const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '.artifacts';
  await fsp.mkdir(ARTIFACT_DIR, { recursive: true });

  app.decorate('health', {
    lastReload: Date.now(),
    counters: { hits: 0, runs: 0, drafts: 0 },
  });

  // Register inflight plugin (self-contained: decoration + hooks)
  // Works in all entry points: main.ts, tests, tools
  await app.register(inflightPlugin);

  // Always-on OpenAPI route for v1 (prod-safe, read-only)
  try {
    app.get('/v1/openapi.json', async (req: any, reply) => {
      try {
        const override = String(process.env.OPENAPI_SPEC_PATH || '').trim();
        if (override) {
          const abs = resolve(process.cwd(), override);
          let buf: Buffer;
          if (abs.endsWith('.json')) {
            buf = await fsp.readFile(abs);
          } else {
            const yaml = await import('yaml');
            const ytxt = await fsp.readFile(abs, 'utf8');
            const obj = yaml.parse(ytxt);
            buf = Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
          }
          const etag = '"' + createHash('sha256').update(buf).digest('hex') + '"';
          const inm = String(req.headers['if-none-match'] || '');
          reply.header('Content-Type', 'application/json; charset=utf-8');
          reply.header('Cache-Control', 'public, max-age=300');
          reply.header('Vary', 'If-None-Match');
          reply.header('ETag', etag);
          if (inm && inm === etag) return reply.code(304).send();
          return reply.code(200).send(buf);
        }
        const openapiJsonPath = resolve(process.cwd(), 'artifact', 'openapi.json');
        if (existsSync(openapiJsonPath)) {
          const buf = await fsp.readFile(openapiJsonPath);
          const etag = '"' + createHash('sha256').update(buf).digest('hex') + '"';
          const inm = String(req.headers['if-none-match'] || '');
          reply.header('Content-Type', 'application/json; charset=utf-8');
          reply.header('Cache-Control', 'public, max-age=300');
          reply.header('Vary', 'If-None-Match');
          reply.header('ETag', etag);
          if (inm && inm === etag) return reply.code(304).send();
          return reply.code(200).send(buf);
        }
        const yaml = await import('yaml');
        const specPath = resolve(process.cwd(), 'contracts', 'openapi.yaml');
        const ytxt = await fsp.readFile(specPath, 'utf8');
        const obj = yaml.parse(ytxt);
        const json = Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
        const etag = '"' + createHash('sha256').update(json).digest('hex') + '"';
        const inm = String(req.headers['if-none-match'] || '');
        reply.header('Content-Type', 'application/json; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=300');
        reply.header('Vary', 'If-None-Match');
        reply.header('ETag', etag);
        if (inm && inm === etag) return reply.code(304).send();
        return reply.code(200).send(json);
      } catch {
        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'OpenAPI serving error',
        });
      }
    });
  } catch { /* ignore */ }

  await app.register(helmet, {
    global: true,
    // Do not set JSON-only headers globally; our securityHeadersOnSend handles JSON paths.
    // This keeps SSE responses free from X-Content-Type-Options and Referrer-Policy etc.
    contentTypeOptions: false as any,
    referrerPolicy: false as any,
    // Disable Helmet's Cache-Control so we can set it per-route
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  } as any);
  // CORS: enable for browser apps with strict preflight
  {
    const { parseCorsCsv } = await import('./lib/corsParser.js');
    const defaultOrigins = 'http://localhost:5173';
    // CORS_ORIGINS is the primary variable (documented, validated), CORS_ALLOW_ORIGINS for backward compat
    const originsCsv = (process.env.CORS_ORIGINS || process.env.CORS_ALLOW_ORIGINS || process.env.WEB_APP_ORIGIN || defaultOrigins).trim();
    const origins = parseCorsCsv(originsCsv, { allowWildcardDev: process.env.CORS_DEV === '1' });
    
    await app.register(cors, {
      origin: origins,
      methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-SCM-Lite', 'x-olumi-payload-hash', 'x-olumi-downstream-calls', 'x-olumi-client-build', 'x-olumi-sdk', 'X-Request-Id', 'X-Correlation-Id'],
      exposedHeaders: [
        'Retry-After',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'X-RateLimit-Reason',
        'X-SCM-Lite',
        'X-Olumi-Backend',
        'X-CEE-Debug',
        'X-CEE-Latency-Ms',
        'X-Build-Tag',
        'x-olumi-service-build',
        'x-olumi-service',
        'x-olumi-response-hash',
        'x-olumi-downstream-calls',
        'X-Request-Id',
      ],
      credentials: false,
      preflight: true,
      strictPreflight: true,
    });
    
    // Warn if production CORS includes localhost
    if (process.env.NODE_ENV === 'production') {
      const hasLocalhost = origins.some(o => 
        o.includes('localhost') || o.includes('127.0.0.1')
      );
      if (hasLocalhost) {
        console.warn(
          '[SECURITY WARNING] Production CORS includes localhost/127.0.0.1. ' +
          'Review CORS_ORIGINS configuration.'
        );
      }
    }
  }

  // Idempotency marker (runs before rate limiter to detect replays)
  const { makeIdempotencyMarker } = await import('./middleware/idempotency-marker.js');
  app.addHook('onRequest', makeIdempotencyMarker());

  // Optional rate limit (enabled by env; disabled when RATE_LIMIT_ENABLED=0)
  if (process.env.RATE_LIMIT_ENABLED !== '0') {
    // Instance-scoped state to prevent cross-test/process bleed
    const rpm = Number(process.env.RATE_LIMIT_RPM) || 60;
    app.decorate('rateLimitState', {
      buckets: new Map(),
      windowMs: 60_000,
      rpm,
    });
    
    const { rateLimiter, commitHook } = makeRateLimiter();
    
    // preHandler: run RPM admission for all methods after validation
    // (Limiter internally handles 413 oversize preflight for POST/PUT/PATCH)
    // Limiter owns all bypass logic via shouldBypass()
    app.addHook('preHandler', rateLimiter as any);
    
    app.addHook('onResponse', commitHook);
    
    // Clean up state on close
    app.addHook('onClose', async () => {
      const state = (app as any).rateLimitState;
      if (state?.buckets) state.buckets.clear();
    });
  }

  // WP-P3: Circuit breaker (flag-gated)
  const { circuitBreakerMiddleware, trackCircuitBreakerResponse } = await import('./middleware/circuitBreaker.js');
  if (process.env.RL_CB_ENABLE === '1') {
    app.addHook('onRequest', circuitBreakerMiddleware);
  }

  // Minimal structured access log without bodies
  app.addHook('onRequest', async (req) => {
    (req as any).startTime = process.hrtime.bigint();
    try { noteLastRequestAt(); } catch { /* ignore */ }

    // P1: Initialize downstream call tracking for this request
    try { initDownstreamTracking(String(req.id)); } catch { /* ignore */ }

    // P1: Capture and validate x-olumi-payload-hash header from client (if provided)
    // Expected format: 12-character lowercase hex string
    const incomingPayloadHash = (req.headers as any)['x-olumi-payload-hash'] || '';
    if (incomingPayloadHash) {
      const trimmed = String(incomingPayloadHash).trim().toLowerCase();
      // Only accept valid 12-char hex format to prevent telemetry pollution
      if (/^[0-9a-f]{12}$/.test(trimmed)) {
        (req as any).__olumi_payload_hash = trimmed;
      } else {
        // Log malformed header but don't store it
        try {
          req.log.warn({
            evt: 'olumi_payload_hash_invalid',
            request_id: req.id,
            received: trimmed.slice(0, 20), // Truncate for safety
          }, 'Invalid x-olumi-payload-hash format (expected 12 hex chars)');
          // P1: Emit metric for invalid payload hash (helps detect abuse or SDK bugs)
          recordPayloadHashInvalid();
        } catch { /* ignore */ }
      }
    }

    // P1: boundary.request logging
    const route = (() => {
      try {
        const url = new URL(req.url, 'http://local');
        return url.pathname;
      } catch {
        return String(req.url || '').split('?')[0].split('#')[0];
      }
    })();
    try {
      req.log.info({
        event: 'boundary.request',
        timestamp: new Date().toISOString(),
        request_id: req.id,
        service: 'plot',
        route,
        method: req.method,
        x_olumi_payload_hash: (req as any).__olumi_payload_hash || null,
      }, 'boundary.request');
    } catch { /* ignore */ }
  });
  // Echo X-Request-ID on all responses and add Olumi observability headers
  app.addHook('onSend', async (req, reply, payload) => {
    try { reply.header('X-Request-ID', String(req.id)); } catch { /* ignore */ }

    // P1: Add x-olumi-service header (all responses)
    try { reply.header('x-olumi-service', 'plot'); } catch { /* ignore */ }

    // P1: Add x-olumi-service-build header (replaces X-Build-Tag, keep both during transition).
    // Uses the shared getBuildId() so the header can never diverge from the /health, /
    // and /version bodies (Codex F12: this hook once emitted 'dev' — it lacked the git
    // fallback that getBuildId() has — while /health reported the real SHA).
    try {
      const buildTag = getBuildId();
      reply.header('x-olumi-service-build', buildTag);
      reply.header('X-Build-Tag', buildTag); // Keep for backward compatibility
    } catch { /* ignore */ }

    // P1: Add x-olumi-response-hash header for JSON responses (lowercase for HTTP/2 compliance)
    // LIMITATION: This only works for buffered JSON responses where Fastify provides the full
    // payload in onSend. For streamed responses (SSE, reply.raw usage, custom serializers returning
    // streams), payload is falsy and the hash header will not be set. This is acceptable for now
    // since our primary use case is buffered JSON API responses.
    try {
      const ct = String(reply.getHeader('Content-Type') || '');
      if (ct.includes('application/json') && payload) {
        let bodyObj: unknown = null;
        if (typeof payload === 'string') {
          try { bodyObj = JSON.parse(payload); } catch { /* ignore */ }
        } else if (Buffer.isBuffer(payload)) {
          // Handle Buffer payloads - convert to string then parse
          try { bodyObj = JSON.parse(payload.toString('utf8')); } catch { /* ignore */ }
        } else if (typeof payload === 'object' && payload !== null) {
          // Plain object - use directly (but not Buffer or other special types)
          bodyObj = payload;
        }
        if (bodyObj && typeof bodyObj === 'object' && !Buffer.isBuffer(bodyObj)) {
          const responseHash = computeOlumiHash(bodyObj);
          reply.header('x-olumi-response-hash', responseHash);
          (req as any).__olumi_response_hash = responseHash;
        }
      }
    } catch { /* ignore */ }

    // P1: Add x-olumi-downstream-calls header (if any downstream calls were made)
    // Format: service:status:elapsedMs:payloadHash:responseHash;...
    try {
      const downstreamHeader = formatDownstreamHeader(String(req.id));
      if (downstreamHeader) {
        reply.header('x-olumi-downstream-calls', downstreamHeader);
      }
    } catch { /* ignore */ }

    // HSTS only in production over TLS (proxied ok via X-Forwarded-Proto)
    try {
      if (process.env.NODE_ENV === 'production') {
        const xf = String((req.headers as any)['x-forwarded-proto'] || '').toLowerCase();
        const proto = xf || String((req as any).protocol || '').toLowerCase();
        if (proto === 'https') reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
      }
    } catch { /* ignore */ }
    return payload as any;
  });
  // JSON-only security headers (SSE exempt via content-type)
  app.addHook('onSend', securityHeadersOnSend);
  app.addHook('onResponse', async (req, reply) => {
    const start = (req as any).startTime as bigint | undefined;
    const end = process.hrtime.bigint();
    const durationMs = start ? Number(end - start) / 1e6 : undefined;
    // Extract route without query params or fragments
    const route = (() => {
      const routeUrl = (req as any)?.routeOptions?.url;
      if (routeUrl) return routeUrl;
      try { 
        const url = new URL((req as any).url, 'http://local');
        return url.pathname;
      }
      catch { 
        const raw = String((req as any).url || '');
        return raw.split('?')[0].split('#')[0];
      }
    })();
    if (typeof durationMs === 'number') {
      try {
        recordDurationMs(durationMs);
        recordStatus(reply.statusCode);
        if (route?.startsWith('/draft-flows')) recordDraftDurationMs(durationMs);
        
        // P1: Observe request duration histogram (flag-gated, no-op when OFF)
        const { observeRequestDuration } = await import('./metrics/registry.js');
        const normalizedRoute = route || 'unknown';
        observeRequestDuration(normalizedRoute, req.method, reply.statusCode, durationMs);
        
        // WP-P3: Track circuit breaker response (flag-gated)
        trackCircuitBreakerResponse(req, reply);
      } catch { /* ignore */ }
    }
    // Update replay lastStatus/lastTs for /draft-flows responses
    if (route?.startsWith('/draft-flows')) {
      try {
        const status = reply.statusCode >= 200 && reply.statusCode < 300 ? 'ok' : 'fail';
        recordReplayStatus(status as 'ok' | 'fail');
      } catch { /* ignore */ }
    }
    app.log.info({ reqId: req.id, route, statusCode: reply.statusCode, durationMs }, 'request completed');

    // P1: boundary.response logging (canonical schema)
    try {
      const requestId = String(req.id);
      // Decision-input minimiser (F1/F3): log-safe projection — hashes,
      // digests, timing, status only. Decision-input bodies (labels, raw
      // values, parameter_uncertainties) are dropped from this INFO log; full
      // bodies appear only under the default-off PLOT_DIAGNOSTIC_LOG_BODIES gate.
      const downstreamCalls = getDownstreamCallsForBoundaryLog(requestId);
      req.log.info({
        event: 'boundary.response',
        timestamp: new Date().toISOString(),
        request_id: req.id,
        service: 'plot',
        route,
        method: req.method,
        status_code: reply.statusCode,
        duration_ms: durationMs,
        x_olumi_response_hash: (req as any).__olumi_response_hash || null,
        downstream: downstreamCalls.length > 0 ? downstreamCalls : null,
      }, 'boundary.response');
      // Clean up downstream tracking for this request
      clearDownstreamTracking(requestId);
    } catch { /* ignore */ }
  });

  // Load fixtures and pre-serialise for legacy POST /draft-flows (C5: cached)
  const { loadFixture } = await import('./lib/fixtures-cache.js');
  const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
  let firstCaseResponseRaw = '';
  const caseMap = new Map<string, string>();
  try {
    const fixturesText = loadFixture(fixturesPath);
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

  // Track fixture readiness for /ready endpoint
  let fixturesReady = false;

  // Register health, readiness, liveness, and version endpoints
  await registerHealthRoutes(app, {
    enableTestRoutes: opts.enableTestRoutes,
    idemCacheSize: () => idemCache.getSize(),
    getReadinessStatus: () => fixturesReady,
  });

  // JSON metrics endpoint (test-only, distinct from Prometheus /metrics)
  if (process.env.METRICS === '1' && process.env.PROMETHEUS_ENABLE !== '1') {
    app.log.info(
      { mode: 'json_metrics', path: '/metrics' },
      'Metrics: JSON /metrics endpoint enabled (Prometheus disabled)'
    );
    app.get('/metrics', async (_req, reply) => {
      reply.header('Content-Type', 'application/json; charset=utf-8');
      const counters = getStreamCounters();
      const currentStreams = getCurrentStreams();
      const lastHeartbeat = getLastHeartbeatMs();
      const draftHistory = getDraftP95History();

      return {
        // Local JSON counters (test SSE) + global stream metrics (real SSE)
        stream_started: jsonStreamStarted + counters.stream_started,
        // Treat done + cancelled as completed streams for mixed-cycle tests
        stream_done: (jsonStreamDone + jsonStreamCancelled) + (counters.stream_done + counters.stream_cancelled),
        stream_cancelled: jsonStreamCancelled + counters.stream_cancelled,
        stream_limited: jsonStreamLimited + counters.stream_limited,
        stream_retryable: jsonStreamRetryable + counters.stream_retryable,
        current_streams: jsonCurrentStreams + currentStreams,
        last_heartbeat_ms: Math.max(jsonLastHeartbeatMs, lastHeartbeat),
        draft_flows_p95_last5: draftFlowsP95Last5.length > 0 ? draftFlowsP95Last5 : draftHistory,
      };
    });
  }

  if (opts.enableTestRoutes || process.env.TEST_ROUTES === '1') {
    const expectedTestAuthHeader = (process.env.TEST_AUTH_TOKEN ?? '').trim() || '1';
    const requireTestAuth = (req: any): boolean => {
      const headers: any = req.headers || {};
      const raw = headers['x-test-auth'] ?? headers['X-Test-Auth'];
      return String(raw ?? '') === expectedTestAuthHeader;
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

    try {
      const { __rateLimitBucketCount } = await import('./rateLimit.js');
      app.get('/__test/rl-bucket', async (req: any, reply) => {
        if (!requireTestAuth(req)) {
          return reply.code(403).type('application/json').send({ error: 'forbidden' });
        }
        const ip = String((req.query?.ip || req.headers['x-forwarded-for'] || req.ip || '') || '');
        const method = String(req.query?.method || 'GET');
        const path = String(req.query?.path || '/draft-flows');
        const n = __rateLimitBucketCount(ip, method, path);
        return reply.code(200).send({ ip, method, path, count: n });
      });
    } catch { /* ignore */ }

    app.get('/demo/stream', async (req: any, reply: any) => {
      const q: any = (req as any).query || {};
      const scenario = typeof q.scenario === 'string' ? q.scenario : 'demo';

      // Basic SSE headers (no JSON security headers)
      reply.header('Content-Type', 'text/event-stream');
      reply.header('Cache-Control', 'no-cache, no-transform');
      reply.header('X-Accel-Buffering', 'no');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Connection', 'keep-alive');
      try { reply.removeHeader('X-Content-Type-Options'); } catch { /* ignore */ }
      try { reply.removeHeader('Referrer-Policy'); } catch { /* ignore */ }
      try { (reply.raw as any).removeHeader?.('X-Content-Type-Options'); } catch { /* ignore */ }
      try { (reply.raw as any).removeHeader?.('Referrer-Policy'); } catch { /* ignore */ }

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

      jsonStreamStarted++;
      jsonCurrentStreams++;
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
        } catch { /* ignore */ }
        jsonStreamDone++;
        if (jsonCurrentStreams > 0) jsonCurrentStreams--;
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
      try { (reply.raw as any).flush?.(); } catch { /* ignore */ }
      try { reply.raw.end(); } catch { /* ignore */ }
      return;
    });

    const registerTestStreamRoute = (path: string) => {
      app.get(path, async (req: any, reply: any) => {
        const headers: any = (req as any).headers || {};
        const q: any = (req as any).query || {};
        // Auth check for /stream route using consolidated auth guard
        const authRequired = process.env.AUTH_ENABLED === '1' && process.env.FEATURE_STREAM === '1' && path === '/stream';
        if (authRequired) {
          if (!(await authGuard(req, reply))) return;
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
        try { reply.removeHeader('X-Content-Type-Options'); } catch { /* ignore */ }
        try { reply.removeHeader('Referrer-Policy'); } catch { /* ignore */ }
        try { (reply.raw as any).removeHeader?.('X-Content-Type-Options'); } catch { /* ignore */ }
        try { (reply.raw as any).removeHeader?.('Referrer-Policy'); } catch { /* ignore */ }

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

        jsonStreamStarted++;
        jsonCurrentStreams++;
        let finished = false;
        let heartbeat: NodeJS.Timeout | null = null;

        const finish = (reason: 'done' | 'cancelled' | 'limited' | 'retryable' | 'blip' | 'abort', opts: { preserveState?: boolean } = {}) => {
          if (finished) return;
          finished = true;
          try {
            const inflight = (app as any).inflight;
            if (inflight && typeof inflight.dec === 'function') {
              (reply.raw as any).__inflightDecDone = true;
              inflight.dec('endStream');
            }
          } catch { /* ignore */ }
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          if (!opts.preserveState) {
            testStreamState.delete(streamId);
            testStreamCancelled.delete(streamId);
          }
          if (reason === 'done') jsonStreamDone++;
          else if (reason === 'cancelled') jsonStreamCancelled++;
          else if (reason === 'limited') jsonStreamLimited++;
          else if (reason === 'retryable') jsonStreamRetryable++;
          if (jsonCurrentStreams > 0) jsonCurrentStreams--;
          try { (reply.raw as any).flush?.(); } catch { /* ignore */ }
          try { reply.raw.end(); } catch { /* ignore */ }
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

        const state: { index: number; blipped?: boolean } =
          testStreamState.get(streamId) || { index: 0, blipped: false };
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
              jsonLastHeartbeatMs = Date.now();
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

        run().catch((err: any) => {
          reply.log?.error?.({ err }, 'test stream run failed');
          finish('abort');
        });
      });
    };

    const registerTestStreamCancelRoute = (path: string) => {
      app.post(path, async (req: any, reply: any) => {
        let id = '';
        try {
          const body: any = (req as any).body;
          if (body && typeof body.id === 'string') id = String(body.id);
        } catch { /* ignore */ }

        if (!id) {
          const q: any = (req as any).query || {};
          if (typeof q.id === 'string') id = String(q.id);
        }

        if (id) testStreamCancelled.add(id);

        reply.header('Content-Type', 'application/json; charset=utf-8');
        return { ok: true };
      });
    };

    registerTestStreamRoute('/test/stream');
    registerTestStreamCancelRoute('/test/stream/cancel');

    if (process.env.FEATURE_STREAM !== '1') {
      registerTestStreamRoute('/stream');
      registerTestStreamCancelRoute('/stream/cancel');
    }

  }

  type AllowedTemplate = 'pricing_change' | 'feature_launch' | 'build_vs_buy';
  type FixtureEntry = { buf: Buffer; etag: string; contentLength: number; metaSeed: number; template: AllowedTemplate };
  const deterministicMap = new Map<string, FixtureEntry>();
  const deterministicRoot = resolve(process.cwd(), 'fixtures');
  async function preloadDeterministic() {
    const templates: AllowedTemplate[] = ['pricing_change','feature_launch','build_vs_buy'];
    for (const tmpl of templates) {
      const dir = joinPath(deterministicRoot, tmpl);
      let files: string[] = [];
      try {
        const ents = await fsp.readdir(dir, { withFileTypes: true });
        files = ents.filter(e => e.isFile() && /^\d+\.json$/.test(e.name)).map(e => e.name);
      } catch {
        continue;
      }
      for (const f of files) {
        const seed = Number(f.replace(/\.json$/, ''));
        if (!Number.isInteger(seed)) continue;
        const abs = joinPath(dir, f);
        const raw = await fsp.readFile(abs);
        let parsed: any;
        try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new Error(`Invalid JSON in ${abs}`); }
        if (parsed?.schema !== 'report.v1') throw new Error(`Missing schema in ${abs}`);
        if (parsed?.meta?.seed !== seed) throw new Error(`meta.seed mismatch in ${abs}`);
        const h = createHash('sha256').update(raw).digest('hex');
        const etag = '"' + h + '"';
        deterministicMap.set(`${tmpl}|${seed}`, { buf: raw, etag, contentLength: raw.length, metaSeed: seed, template: tmpl });
      }
    }
  }
  await preloadDeterministic();
  fixturesReady = true;

  app.get('/draft-flows', async (req, reply) => {
    if (!(await authGuard(req, reply))) return;
    const q = (req as any).query || {};
    const fields: Record<string, any> = {};
    const template = typeof q.template === 'string' ? q.template : '';
    const seedNum = (typeof q.seed === 'string' || typeof q.seed === 'number') ? Number(q.seed) : NaN;
    const budgetNum = q.budget == null ? null : Number(q.budget);
    const allowed = new Set(['pricing_change','feature_launch','build_vs_buy']);
    if (!allowed.has(template)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 404,
        key: 'INVALID_TEMPLATE',
        devDetail: { template },
      });
    }
    if (!Number.isInteger(seedNum)) fields.seed = 'must be an integer';
    if (q.budget != null && (!Number.isInteger(budgetNum as number))) fields.budget = 'must be an integer if provided';

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
      const force = getForcedError(req as any);
      if (force === 'TIMEOUT') { return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' }); }
      if (force === 'RETRYABLE') { return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true }); }
      if (force === 'INTERNAL') { throw new Error('Forced internal'); }
    }

    const key = `${template}|${seedNum}`;
    const entry = deterministicMap.get(key);
    if (!entry) {
      return replyWithAppError(reply, { type: 'BAD_INPUT', statusCode: 404, key: 'INVALID_SEED', devDetail: { template, seed: seedNum } });
    }

    const inm = (req.headers['if-none-match'] as string | undefined) || '';
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
    app.head('/draft-flows', async (req: any, reply) => {
      const q = (req as any).query || {};
      const template = typeof q.template === 'string' ? q.template : '';
      const seedNum = (typeof q.seed === 'string' || typeof q.seed === 'number') ? Number(q.seed) : NaN;
      const allowed = new Set(['pricing_change','feature_launch','build_vs_buy']);
      if (!allowed.has(template) || !Number.isInteger(seedNum)) {
        return reply.code(400).send();
      }
      const key = `${template}|${seedNum}`;
      const entry = deterministicMap.get(key);
      if (!entry) return reply.code(404).send();
      reply.header('Content-Type', 'application/json');
      reply.header('Cache-Control', 'no-cache');
      reply.header('Vary', 'If-None-Match');
      reply.header('ETag', entry.etag);
      reply.header('Content-Length', String(entry.contentLength));
      return reply.code(200).send();
    });
  } catch (err: any) {
    // Swallow FST_ERR_DUPLICATED_ROUTE only; rethrow others
    if (err?.code !== 'FST_ERR_DUPLICATED_ROUTE') throw err;
  }

  app.post('/draft-flows', async (req, reply) => {
    if (!(await authGuard(req, reply))) return;
    const body: any = (req as any).body || {};
    // Test error header
    {
      const force = getForcedError(req as any);
      if (force === 'TIMEOUT') { return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' }); }
      if (force === 'RETRYABLE') { return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true }); }
      if (force === 'INTERNAL') { throw new Error('Forced internal'); }
    }
    // Idempotency replay (pre-check)
    {
      const key = getIdempotencyKey(req as any);
      if (key) {
        const { canonicalStringify, sha256Hex } = await import('./util/canonical.js');
        const bodyHash = sha256Hex(canonicalStringify(body));
        // Search any existing entry for same key regardless of body to detect mismatch
        const cacheKey = getCacheKey(key, bodyHash);
        const entry = idemCache.get(cacheKey);
        if (entry) {
          reply.header('Content-Type', 'application/json');
          return reply.send(entry.responseText);
        }
        const principal = extractPrincipal(req);
        principalQuotas.track(principal, getCacheKey(key, bodyHash));
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
      } catch (err) {
        // Non-fatal: fall through to deep scan if fast path fails
        app.log?.debug?.({
          evt: 'sensitive_scan_fallback',
          err,
          reqId: req.id,
          route: '/draft-flows'
        }, '[sensitive-scan] Fast path failed, using deep scan');
      }
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
        idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText });
        try { setIdemCacheSize(idemCache.getSize()); } catch { /* ignore */ }
      }
    }

    return reply.send(respText);
  });

  app.post('/critique', async (req: any, reply) => {
    if (!(await authGuard(req, reply))) return;
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
      } catch { /* ignore */ }
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
        const { canonicalStringify, sha256Hex } = await import('./util/canonical.js');
        const bodyHash = sha256Hex(canonicalStringify(body));
        const cacheKey = getCacheKey(key, bodyHash);
        const entry = idemCache.get(cacheKey);
        if (entry) {
          reply.header('Content-Type', 'application/json');
          return reply.send(entry.responseText);
        }
        const principal = extractPrincipal(req);
        principalQuotas.track(principal, getCacheKey(key, bodyHash));
        (req as any).__idem = { key, bodyHash };
      }
    }

    // Header forced errors
    {
      const force = getForcedError(req as any);
      if (force === 'TIMEOUT') { return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' }); }
      if (force === 'RETRYABLE') { return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true }); }
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
        const respText = JSON.stringify(obj);
        reply.header('Content-Type', 'application/json');
        idemCache.set(getCacheKey(idem.key, idem.bodyHash), { bodyHash: idem.bodyHash, responseText: respText });
        try { setIdemCacheSize(idemCache.getSize()); } catch { /* ignore */ }
        return reply.send(respText);
      }
    }

    return obj;
  });

  app.post('/improve', async (req: any, reply) => {
    if (!(await authGuard(req, reply))) return;
    const { parse_json } = req.body || {};
    if (typeof parse_json === 'undefined') { const { errorResponse } = await import('./errors.js'); return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object to be echoed back')); }
    return { parse_json, fix_applied: [] };
  });

  // Test-only error injection
  if (opts.enableTestRoutes || process.env.TEST_ROUTES === '1') {
    app.post('/__test/force-error', async (req: any, reply) => {
      const t = (req.body?.type || req.query?.type || '').toString().toUpperCase();
      if (t === 'TIMEOUT') return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time' });
      if (t === 'RETRYABLE') return replyWithAppError(reply, { type: 'RETRYABLE', statusCode: 503, hint: 'Please retry', retryable: true });
      if (t === 'INTERNAL') return replyWithAppError(reply, { type: 'INTERNAL', statusCode: 500, hint: 'See server logs' });
      return replyWithAppError(reply, { type: 'BAD_INPUT', statusCode: 400, message: 'Unknown type', hint: 'Use TIMEOUT, RETRYABLE, or INTERNAL' });
    });

    // Internal replay telemetry — test mode only
    app.get('/internal/replay-status', async (_req, reply) => {
      return reply.code(200).send(replaySnapshot());
    });
    app.post('/internal/replay-report', async (req: any, _reply) => {
      try {
        const b = req.body || {};
        if (b.refusal) recordReplayRefusal();
        if (b.retry) recordReplayRetry();
        if (b.status === 'ok' || b.status === 'fail') recordReplayStatus(b.status);
        return { ok: true };
      } catch { /* ignore */ }
      return { ok: false };
    });

  }

  // --- Real SSE route (FEATURE_STREAM=1) ---
  if (process.env.FEATURE_STREAM === '1') {
    app.get('/stream', async (req: any, reply: any) => {
      // Auth gate (minimal)
      if (!(await authGuard(req, reply))) return;

      // SSE headers
      reply.header('Content-Type', 'text/event-stream');
      reply.header('Cache-Control', 'no-cache');
      reply.header('Connection', 'keep-alive');
      reply.hijack();

      // Note: onRequest already incremented inflight
      // endStream must decrement since onResponse won't fire after hijack

      try { streamStarted?.(); } catch { /* ignore */ }
      try { incCurrentStreams?.(); } catch { /* ignore */ }

      const q = (req as any).query || {};
      const forceLimit = String(process.env.STREAM_FORCE_LIMIT || '').toLowerCase() === '1';
      const sleepMs = Number(q.sleepMs || q.latency_ms || 0);
      const hbSec = Number(process.env.STREAM_HEARTBEAT_SEC || 25);
      const hbMs = Math.max(1, Math.floor(hbSec * 1000));

      function writeLine(txt: string) { try { return reply.raw.write(txt); } catch { return false; } }
      function writeComment(txt: string) { return writeLine(`: ${txt}\n\n`); }
      function writeSse(id: number | string, ev: string, data: any) {
        writeLine(`id: ${id}\n`);
        writeLine(`event: ${ev}\n`);
        writeLine(`data: ${JSON.stringify(data)}\n\n`);
      }

      // Heartbeat timer
      let closed = false;
      let hb: NodeJS.Timeout;

      const endStream = (fn?: () => void) => {
        if (closed) return; // Idempotent: prevent double-decrement
        closed = true;
        if (hb) clearInterval(hb);
        try { reply.raw.end(); } catch { /* ignore */ }
        try { fn?.(); } catch { /* ignore */ }
        try { decCurrentStreams?.(); } catch { /* ignore */ }
        
        // Mark as decremented to prevent onResponse from also decrementing
        (reply.raw as any).__inflightDecDone = true;
        
        // Decrement inflight (matches global onRequest increment)
        app.inflight.dec('endStream');
      };

      // P0: Handle client disconnect (use .once for deterministic cleanup)
      reply.raw.once('close', () => {
        app.log.info({ reqId: req.id }, 'SSE client disconnected');
        endStream();
      });

      reply.raw.once('error', (err: any) => {
        app.log.error({ reqId: req.id, err }, 'SSE stream error');
        endStream();
      });

      // Leak-safe heartbeat: check socket state before writing
      hb = setInterval(() => {
        if (closed) return;
        // Prevent leak: if socket destroyed or not writable, cleanup and exit
        if (reply.raw.destroyed || !reply.raw.writable) {
          endStream();
          return;
        }
        writeComment(`ping ts=${Date.now()}`);
        try { noteHeartbeat?.(); } catch { /* ignore */ }
      }, hbMs);
      hb.unref(); // Don't keep process alive

      // Forced limited hook for deterministic testing of backpressure mapping
      if (forceLimit) {
        writeSse('0', 'limited', { reason: 'backpressure' });
        try { streamLimited?.(); } catch { /* ignore */ }
        return endStream();
      }

      // Minimal sequence (hello -> token -> cost -> done) with optional latency
      const seq: Array<{ ev: 'hello'|'token'|'cost'|'done'; body: any }> = [
        { ev: 'hello', body: { ts: new Date().toISOString() } },
        { ev: 'token', body: { text: 'draft', index: 0 } },
        { ev: 'cost', body: { tokens: 5, currency: 'USD', amount: 0.0 } },
        { ev: 'done', body: { reason: 'complete' } },
      ];

      const lastIdRaw: string | undefined = (req.headers['last-event-id'] as string | undefined) || (q.lastEventId as string | undefined);
      let idxStart = lastIdRaw ? Math.min(seq.length, Number(lastIdRaw) + 1) : 0;

      for (let i = idxStart; i < seq.length; i++) {
        if (sleepMs > 0) { await new Promise(r => setTimeout(r, sleepMs)); }
        const e = seq[i];
        // Detect backpressure on write
        writeSse(String(i), e.ev, e.body);
        // If the socket is congested (rare in tests), map to limited and close
        const needDrain = (reply.raw as any)?.writableNeedDrain === true;
        if (needDrain) {
          writeSse(String(i), 'limited', { reason: 'backpressure' });
          try { streamLimited?.(); } catch { /* ignore */ }
          return endStream();
        }
      }
      try { streamDone?.(); } catch { /* ignore */ }
      return endStream();
    });
  }

  // Simple global error handler mapping to typed error
  app.setErrorHandler(async (err, req, reply) => {
    const code = (err as any)?.code || '';
    const emsgRaw = (err as any)?.message || '';
    const emsg = String(emsgRaw).toLowerCase();
    // Normalize route: prefer routerPath (e.g. "/v1/run"), fallback to URL path
    const route = (req as any).routerPath || (req as any).routeOptions?.url || req.url?.split('?')[0] || 'unknown';
    
    // P0-1: Track validation errors
    const { incValidationError } = await import('./observability/validationMetrics.js');
    if ((err as any).validation) {
      const validationContext = (err as any).validationContext;
      const phase = validationContext === 'response' ? 'response' : 'request';
      incValidationError(route, phase, 'ajv');
      
      // Extract field name from validation errors for better DX
      const validation = (err as any).validation || [];
      let errorMsg = 'Validation failed';
      let field = '';
      let hint = '';
      
      if (Array.isArray(validation) && validation.length > 0) {
        const firstErr = validation[0];
        if (firstErr.params?.missingProperty) {
          field = firstErr.params.missingProperty;
          errorMsg = `Missing required field: ${field}`;
          hint = `Include '${field}' in your request`;
        } else if (firstErr.params?.additionalProperty) {
          field = firstErr.params.additionalProperty;
          errorMsg = `Unknown field: ${field}`;
          hint = `Remove '${field}' or check spelling`;
        } else if (firstErr.message) {
          errorMsg = firstErr.message;
        }
      }
      
      // Return 400 with field-specific error
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400, 
        message: errorMsg,
        hint: hint || 'Check request format',
        fields: field ? { field } : undefined,
        devDetail: field || JSON.stringify(validation)
      });
    }
    
    // Timeouts
    if (code === 'FST_ERR_REQUEST_TIMEOUT' || /timeout/i.test(emsgRaw)) {
      return replyWithAppError(reply, { type: 'TIMEOUT', statusCode: 504, hint: 'Reduce processing time', devDetail: emsgRaw });
    }
    // Body too large → 413
    const isBodyTooLarge = (err as any)?.statusCode === 413
      || code.includes('BODY_TOO_LARGE')
      || emsg.includes('body limit')
      || emsg.includes('payload too large')
      || emsg.includes('too large');
    if (isBodyTooLarge) {
      // P0: Clear inflight idempotency key on 413
      const idk = req.headers['idempotency-key'];
      if (idk && typeof idk === 'string') {
        try {
          const { clearInflight, principalFor } = await import('./middleware/idempotency.js');
          clearInflight(principalFor(req), idk.trim());
        } catch { /* ignore */ }
      }
      // Structured log for 413
      const bytes = req.headers['content-length'] ? Number(req.headers['content-length']) : 0;
      const sanitizedRoute = (req as any).routerPath || (req as any).routeOptions?.url || (() => {
        try { return new URL(req.url, 'http://local').pathname; }
        catch { return String(req.url || '').split('?')[0].split('#')[0]; }
      })();
      req.log.warn({ evt: 'oversize', id: req.id, route: sanitizedRoute, bytes, reason: 'body_too_large' });
      return replyWithAppError(reply, { type: 'BAD_INPUT', statusCode: 413, message: 'Request entity too large' });
    }
    // Fallback INTERNAL.
    //
    // This branch used to reply "Something went wrong" while logging NOTHING.
    // Fastify does not auto-log once a custom error handler is installed, so an
    // unhandled throw left no trace anywhere: a lane debugging live 500s on
    // /v1/analysis/sequential and /v1/analysis/policy-tree had no log line to
    // find and could not identify the failing line. An unexplainable 5xx is a
    // defect in its own right, independent of whatever caused it.
    //
    // What is logged: the error's identity and stack only — never the request
    // body, headers or query. Every field still passes through THE logger
    // boundary (src/logging/log-boundary.ts), which digests the decision tokens
    // registered from this request's body at preValidation, so user content
    // interpolated into an error message is scrubbed there rather than here.
    // `id` matches the `request_id` returned to the caller in the 500 body.
    req.log.error({
      evt: 'unhandled_error',
      id: req.id,
      route,
      err_name: (err as any)?.name,
      err_code: code || undefined,
      err_message: emsgRaw,
      status_code: (err as any)?.statusCode,
      stack: (err as any)?.stack,
    });

    const { msg } = await import('./lib/error-messages.js');
    return replyWithAppError(reply, { type: 'INTERNAL', statusCode: 500, message: msg('INTERNAL_UNEXPECTED') });
  });

  // Dev-only /openapi.json route with strong ETag, 304 handling, and per-client rate limit
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

      const now = Date.now();
      const retryAfter = consumeDevOpenapiSlot(req, now);
      if (retryAfter !== null) {
        reply.header('Retry-After', String(retryAfter));
        return reply.code(429).send();
      }

      try {
        const override = String(process.env.OPENAPI_SPEC_PATH || '').trim();
        const specPath = override || resolve(process.cwd(), 'contracts', 'openapi.yaml');
        if (override && !existsSync(specPath)) {
          return replyWithAppError(reply as any, {
            type: 'INTERNAL',
            statusCode: 500,
            message: 'OpenAPI spec override not found',
          });
        }

        let txt: string;
        if (specPath.endsWith('.json')) {
          txt = await fsp.readFile(specPath, 'utf8');
        } else {
          const yaml = await import('yaml');
          const ytxt = await fsp.readFile(specPath, 'utf8');
          const obj = yaml.parse(ytxt);
          txt = JSON.stringify(obj, null, 2) + '\n';
        }

        const doc = JSON.parse(txt);
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

  // Register /v1 routes (PLoT Engine v1 with trust signals)
  const { registerV1Routes } = await import('./routes/v1/index.js');
  await registerV1Routes(app);

  // Register /v2 routes (Option Comparison Mode - canonical model)
  const { registerV2Routes } = await import('./routes/v2/index.js');
  await registerV2Routes(app);

  // Prometheus /metrics (C4, flag-gated)
  const { registerPrometheusMetrics } = await import('./plugins/metrics.js');
  await registerPrometheusMetrics(app);

  // P2: /ops/snapshot (flag-gated, redacted)
  const { registerOpsSnapshot } = await import('./routes/ops/snapshot.js');
  await registerOpsSnapshot(app);

  // P0.2: Expose cache stats for /v1/health observability
  (app as any).getIdemCacheStats = () => idemCache.getStats();

  // Note: app.ready() is called by main.ts after adding inflight hooks
  // Do NOT call app.ready() here - it prevents adding hooks later
  return app;
}
