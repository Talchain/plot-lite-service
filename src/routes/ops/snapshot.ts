/**
 * P2: /ops/snapshot - Operational visibility endpoint
 * Flag: OPS_SNAPSHOT_ENABLE='1'
 * Auth: X-OPS-KEY (when AUTH_ENABLED!='1') or Bearer (when AUTH_ENABLED='1')
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { replyWithAppError } from '../../errors.js';
import { getExpectedAuthToken } from '../../config/auth-token.js';
import {
  getEngineP95Ms,
  getEngineP95MsRolling,
  getLastComputeMs,
  getSseOpen,
  getSseClosed,
  getSseTimeout,
  getJson429Count,
  getSse429Count,
  eventLoopDelayMs,
} from '../../metrics.js';
import { getFixtureCacheStats } from '../../lib/fixtures-cache.js';

/**
 * Auth gate for /ops/snapshot
 *
 * On failure, returns a Fastify reply produced by replyWithAppError so that
 * the caller can short-circuit and avoid any double-send of headers.
 */
async function opsAuthGuard(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  // If AUTH_ENABLED='1', use standard bearer auth
  if (process.env.AUTH_ENABLED === '1') {
    const hdr = String((req.headers?.authorization || req.headers?.Authorization || '') || '');
    // Same single source of truth as the main auth guard: PLOT_AUTH_TOKEN
    // (caller-facing / provisioned) with an AUTH_TOKEN fallback. Reached only
    // inside the AUTH_ENABLED==='1' branch, so inert until the auth flip.
    const expected = getExpectedAuthToken();

    if (!hdr.startsWith('Bearer ')) {
      try {
        reply.header('WWW-Authenticate', 'Bearer');
      } catch (err) {
        req.log?.error?.({
          evt: 'auth_header_failed',
          reqId: req.id,
          route: '/ops/snapshot',
          header: 'WWW-Authenticate',
          error: err instanceof Error ? err.message : String(err)
        }, 'Failed to set WWW-Authenticate header on 401 response');
      }
      return replyWithAppError(reply as any, {
        type: 'BAD_INPUT',
        statusCode: 401,
        message: 'Missing bearer token',
        fields: { code: 'UNAUTHORIZED' },
      }) as any;
    }

    const tok = hdr.slice('Bearer '.length).trim();
    if (!expected || tok.length !== expected.length) {
      return replyWithAppError(reply as any, {
        type: 'BAD_INPUT',
        statusCode: 403,
        message: 'Invalid token',
        fields: { code: 'FORBIDDEN' },
      }) as any;
    }

    if (!timingSafeEqual(Buffer.from(tok), Buffer.from(expected))) {
      return replyWithAppError(reply as any, {
        type: 'BAD_INPUT',
        statusCode: 403,
        message: 'Invalid token',
        fields: { code: 'FORBIDDEN' },
      }) as any;
    }

    return;
  }

  // Otherwise, require X-OPS-KEY header
  const opsKey = String((req.headers['x-ops-key'] || '') || '');
  const expected = String(process.env.OPS_KEY || '').trim();

  if (!expected) {
    // Fail closed: no default OPS_KEY
    try {
      reply.header('WWW-Authenticate', 'ops-key');
    } catch (err) {
      req.log?.error?.({
        evt: 'auth_header_failed',
        reqId: req.id,
        route: '/ops/snapshot',
        header: 'WWW-Authenticate',
        error: err instanceof Error ? err.message : String(err)
      }, 'Failed to set WWW-Authenticate header on 401 response');
    }
    return replyWithAppError(reply as any, {
      type: 'BAD_INPUT',
      statusCode: 401,
      message: 'OPS_KEY not configured',
      fields: { code: 'UNAUTHORIZED' },
    }) as any;
  }

  if (!opsKey) {
    try {
      reply.header('WWW-Authenticate', 'ops-key');
    } catch (err) {
      req.log?.error?.({
        evt: 'auth_header_failed',
        reqId: req.id,
        route: '/ops/snapshot',
        header: 'WWW-Authenticate',
        error: err instanceof Error ? err.message : String(err)
      }, 'Failed to set WWW-Authenticate header on 401 response');
    }
    return replyWithAppError(reply as any, {
      type: 'BAD_INPUT',
      statusCode: 401,
      message: 'Missing X-OPS-KEY header',
      fields: { code: 'UNAUTHORIZED' },
    }) as any;
  }

  if (opsKey.length !== expected.length) {
    return replyWithAppError(reply as any, {
      type: 'BAD_INPUT',
      statusCode: 401,
      message: 'Invalid X-OPS-KEY',
      fields: { code: 'UNAUTHORIZED' },
    }) as any;
  }

  if (!timingSafeEqual(Buffer.from(opsKey), Buffer.from(expected))) {
    return replyWithAppError(reply as any, {
      type: 'BAD_INPUT',
      statusCode: 401,
      message: 'Invalid X-OPS-KEY',
      fields: { code: 'UNAUTHORIZED' },
    }) as any;
  }

  return;
}

/**
 * Register /ops/snapshot route (flag-gated)
 */
export async function registerOpsSnapshot(app: FastifyInstance) {
  if (process.env.OPS_SNAPSHOT_ENABLE !== '1') {
    return; // Route not registered
  }

  app.get('/ops/snapshot', async (req, reply) => {
    // Auth gate
    const authResult = await opsAuthGuard(req, reply);
    if (authResult !== undefined) return authResult; // Error response already produced

    // Build snapshot payload
    const redactions: string[] = [
      'request.headers.Authorization',
      'request.headers.authorization',
      'env.TOKEN_HMAC_SECRET',
      'env.OPS_KEY',
      'env.AUTH_TOKEN',
    ];

    // Runtime stats
    const mem = process.memoryUsage();
    const runtime = {
      node: process.version,
      uptime_s: Math.round(process.uptime()),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      eventloop_delay_ms: eventLoopDelayMs(),
    };

    // Engine stats (reuse existing accessors)
    const engine = {
      p95_ms: getEngineP95Ms() || 0,
      p99_ms: getEngineP95MsRolling() || 0, // Using rolling as p99 proxy
      last_compute_ms: getLastComputeMs() || 0,
    };

    // Cache stats (P0 accessors)
    const idemStats = (app as any).getIdemCacheStats?.() || {
      size: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      hitRate: 0,
    };
    const fixtureStats = getFixtureCacheStats();

    const caches = {
      idempotency: idemStats,
      fixtures: fixtureStats,
    };

    // SSE stats
    const sse = {
      open: getSseOpen(),
      closed: getSseClosed(),
      timeout: getSseTimeout(),
    };

    // Rate limit stats
    const rate_limit = {
      enabled: process.env.RATE_LIMIT_ENABLED !== '0',
      rpm: parseInt(process.env.RATE_LIMIT_RPM || '60', 10),
      last5m_429: getJson429Count() + getSse429Count(),
    };

    // Feature flags
    const flags = {
      PROMETHEUS_ENABLE: process.env.PROMETHEUS_ENABLE === '1' ? 'ON' : 'OFF',
      SCM_LITE_ENABLE: process.env.SCM_LITE_ENABLE === '1' ? 'ON' : 'OFF',
      AUTH_ENABLED: process.env.AUTH_ENABLED === '1' ? 'ON' : 'OFF',
      OPS_SNAPSHOT_ENABLE: process.env.OPS_SNAPSHOT_ENABLE === '1' ? 'ON' : 'OFF',
      TOKEN_RL_ENABLE: process.env.TOKEN_RL_ENABLE === '1' ? 'ON' : 'OFF',
      WHATIF_DELTA_ENABLE: process.env.WHATIF_DELTA_ENABLE === '1' ? 'ON' : 'OFF',
    };

    // Build snapshot
    const snapshot = {
      schema: 'ops.snapshot.v1',
      version: process.env.BUILD_ID || 'dev',
      timestamp: new Date().toISOString(),
      prom_enabled: process.env.PROMETHEUS_ENABLE === '1',
      runtime,
      engine,
      caches,
      sse,
      rate_limit,
      flags,
      redactions,
    };

    reply.type('application/json; charset=utf-8');
    return snapshot;
  });
}
