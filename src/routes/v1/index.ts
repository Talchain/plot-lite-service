/**
 * /v1 Routes Registration
 * All PLoT Engine v1 endpoints with trust signals
 */

import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { registerRunRoute } from './run.js';
import { registerCounterfactualRoute } from './counterfactual.js';
import { registerCritiqueRoute } from './critique.js';
import { registerDraftRoute } from './draft.js';
import { registerSelfCheckRoute } from './self-check.js';
import { registerTemplatesRoutes } from './templates.js';
import { registerLimitsRoute } from './limits.js';
import { registerValidateRoute } from './validate.js';
import { getStreamHealthExtras, p95Ms, snapshot, getLastRequestAt, getJson429Count, getSse429Count, getLastConfigReloadISO, getLastComputeMs, getEngineP95Ms, getEngineP95MsRolling, getSseOpen, getSseClosed, getSseTimeout } from '../../metrics.js';
import { getFixtureCacheSize, getFixtureCacheStats } from '../../lib/fixtures-cache.js';
import { registerStreamRoute } from './stream.js';
import { registerStreamRouteEnhanced } from './stream-enhanced.js';
import { isDemoMode } from '../../middleware/demo-mode.js';
import { getIdemStoreSize } from '../../middleware/idempotency.js';
import { healthResponseSchema } from '../../schemas/response.js';

/**
 * Auth preHandler for /v1/* routes
 * Guards all v1 endpoints when AUTH_ENABLED=1
 */
async function v1AuthGuard(req: any, reply: any) {
  if (process.env.AUTH_ENABLED !== '1') return;
  // Demo bypass ONLY for GET /v1/stream when isDemoMode(req) is true
  try {
    const urlStr = String(req.url || '/');
    const u = new URL(urlStr, 'http://local');
    const isStream = String(req.method || 'GET').toUpperCase() === 'GET' && u.pathname === '/v1/stream';
    if (isStream && isDemoMode(req)) return; // auth bypass only
  } catch {}
  
  const hdr = String((req.headers?.authorization || req.headers?.Authorization || '') || '');
  const expected = String(process.env.AUTH_TOKEN || '').trim();
  
  if (!hdr.startsWith('Bearer ')) {
    reply.header('WWW-Authenticate', 'Bearer');
    return reply.code(401).send({ 
      schema: 'error.v1',
      code: 'UNAUTHORIZED', 
      message: 'Missing bearer token' 
    });
  }
  
  const tok = hdr.slice('Bearer '.length).trim();
  if (!expected || tok.length !== expected.length) {
    return reply.code(403).send({ 
      schema: 'error.v1',
      code: 'FORBIDDEN', 
      message: 'Invalid token' 
    });
  }
  if (!timingSafeEqual(Buffer.from(tok), Buffer.from(expected))) {
    return reply.code(403).send({ 
      schema: 'error.v1',
      code: 'FORBIDDEN', 
      message: 'Invalid token' 
    });
  }
}

/**
 * Register all /v1 routes
 */
export async function registerV1Routes(app: FastifyInstance) {
  // Add auth guard hook for all /v1/* routes
  app.addHook('preHandler', async (req, reply) => {
    // Only apply to /v1/* routes
    if (req.url?.startsWith('/v1/')) {
      await v1AuthGuard(req, reply);
    }
  });

  // Optional JSON trace passthrough for v1 JSON responses (off by default)
  app.addHook('onSend', async (req: any, reply: any, payload: any) => {
    try {
      if (process.env.TRACE_ID_PASSTHROUGH !== '1') return payload;
      const url: string = String(req.url || '');
      if (!url.startsWith('/v1/')) return payload;
      const ct = String(reply.getHeader('Content-Type') || '');
      if (!ct.toLowerCase().includes('application/json')) return payload;
      const hdrs = req.headers || {};
      const trace = hdrs['x-trace-id'] || hdrs['X-Trace-Id'];
      if (!trace) return payload;
      if (typeof payload === 'string') {
        try {
          const obj = JSON.parse(payload);
          if (obj && typeof obj === 'object') {
            obj.trace_id = String(trace);
            return JSON.stringify(obj);
          }
        } catch { return payload; }
      } else if (payload && typeof payload === 'object') {
        try { (payload as any).trace_id = String(trace); } catch {}
        return payload;
      }
      return payload;
    } catch {
      return payload;
    }
  });

  // Register v1 endpoints (all protected by auth guard)
  await registerRunRoute(app);
  await registerCounterfactualRoute(app);
  await registerCritiqueRoute(app);
  await registerDraftRoute(app);
  await registerSelfCheckRoute(app);
  await registerTemplatesRoutes(app);
  await registerLimitsRoute(app);
  
  // Test-only: echo env vars for debugging
  if (process.env.TEST_ROUTES === '1') {
    app.get('/__env', async () => ({
      SCM_LITE_ENABLE: process.env.SCM_LITE_ENABLE ?? null,
      RATE_LIMIT_RPM: process.env.RATE_LIMIT_RPM ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
    }));
  }
  
  await registerValidateRoute(app);
  await registerCompareRoute(app);
  await registerInspectRoute(app);
  await registerScoreRoute(app);
  await registerInterveneRoute(app);  
  // P1: Register enhanced stream route if enabled, otherwise use legacy
  if (process.env.STREAM_PARITY_ENABLE === '1') {
    await registerStreamRouteEnhanced(app);
  } else {
    await registerStreamRoute(app);
  }

  // Health and version at /v1 as well (for consistency)
  // Note: No response validation - health returns dynamic fields based on runtime state
  app.get('/v1/health', async () => {
    const base = {
      status: 'ok',
      api_version: 'v1',
      p95_ms: p95Ms() || 0,
      version: '1.0.0',
      uptime_s: Math.round(process.uptime()),
      last_request_at: getLastRequestAt() || undefined,
      ...snapshot(),
      // Always expose 429 counters as integers
      json_429_count: getJson429Count(),
      sse_429_count: getSse429Count(),
      // SSE guardrails (C3)
      sse_open: getSseOpen(),
      sse_closed: getSseClosed(),
      sse_timeout: getSseTimeout(),
      // Idempotency cache size for observability
      idem_cache_size: getIdemStoreSize(),
      // P0.2: Idempotency cache stats (hits, misses, evictions, hitRate)
      idem_cache_stats: (app as any).getIdemCacheStats?.() || null,
      // Fixture cache (C5)
      fixtures_cache_size: getFixtureCacheSize(),
      // P0.2: Fixture cache stats
      fixtures_cache_stats: getFixtureCacheStats(),
      // Engine compute metrics
      last_compute_ms: getLastComputeMs(),
      engine_p95_ms: getEngineP95Ms(),
      engine_p95_ms_rolling: getEngineP95MsRolling(),
    } as any;
    // WP-P3: Circuit breaker stats (flag-gated)
    try {
      const { getCircuitBreakerStats } = await import('../../middleware/circuitBreaker.js');
      const cbStats = getCircuitBreakerStats();
      if (cbStats) base.circuit_breaker = cbStats;
    } catch {}
    // PR-3: Principal extraction stats
    try {
      const { getPrincipalExtractionStats } = await import('../../lib/extractPrincipal.js');
      base.principal_extraction = getPrincipalExtractionStats();
    } catch {}
    // Optional environment/build hints for ops triage
    try {
      const env = process.env.ENVIRONMENT;
      if (env) base.environment = env;
    } catch {}
    try {
      const b = process.env.BUILD_ID_SHORT || '';
      if (b) base.build = b;
    } catch {}
    try {
      const extras = getStreamHealthExtras();
      if (extras && typeof extras === 'object') {
        for (const [k, v] of Object.entries(extras)) {
          if (typeof v === 'number') base[k] = v;
        }
      }
    } catch {}
    // Optional last reload timestamp
    try {
      const iso = getLastConfigReloadISO();
      if (iso) base.last_config_reload_iso = iso;
    } catch {}
    return base;
  });

  app.get('/v1/version', async () => {
    // Read BUILD_ID or git sha
    const build = process.env.BUILD_ID || 'dev';
    return {
      api: 'plot-engine/v1',
      version: '1.0.0',
      build,
      model: `plot-lite-${build}`,
      features: {
        trust_signals: true,
        model_card: '1.1',
        confidence_badge: true,
        explain_delta: true,
        cost_governance: true,
      },
    };
  });
}

// Import new routes
import { registerCompareRoute } from './compare.js';
import { registerInspectRoute } from './inspect.js';
import { registerScoreRoute } from './score.js';
import { registerInterveneRoute } from './intervene.js';
