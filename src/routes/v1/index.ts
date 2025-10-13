/**
 * /v1 Routes Registration
 * All PLoT Engine v1 endpoints with trust signals
 */

import type { FastifyInstance } from 'fastify';
import { registerRunRoute } from './run.js';
import { registerCounterfactualRoute } from './counterfactual.js';
import { registerCritiqueRoute } from './critique.js';
import { registerDraftRoute } from './draft.js';
import { registerSelfCheckRoute } from './self-check.js';
import { getStreamHealthExtras } from '../../metrics.js';
import { registerStreamRoute } from './stream.js';
import { isDemoMode } from '../../middleware/demo-mode.js';

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
  if (!expected || tok !== expected) {
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
  await registerStreamRoute(app);

  // Health and version at /v1 as well (for consistency)
  app.get('/v1/health', async () => {
    const { p95Ms, snapshot, getLastRequestAt, getJson429Count, getSse429Count, getLastConfigReloadISO } = await import('../../metrics.js');
    const base = {
      status: 'ok',
      api_version: 'v1',
      p95_ms: p95Ms?.() || 0,
      version: '1.0.0',
      uptime_s: Math.round(process.uptime()),
      last_request_at: getLastRequestAt?.() || undefined,
      ...snapshot?.(),
    } as any;
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
      const extras = getStreamHealthExtras?.();
      if (extras && typeof extras === 'object') {
        for (const [k, v] of Object.entries(extras)) {
          if (typeof v === 'number') base[k] = v;
        }
      }
    } catch {}
    // Optional counters and last reload timestamp
    try {
      const j = typeof getJson429Count === 'function' ? getJson429Count() : 0;
      (base as any).json_429_count = j;
    } catch {}
    try {
      const s = typeof getSse429Count === 'function' ? getSse429Count() : 0;
      (base as any).sse_429_count = s;
    } catch {}
    try {
      const iso = typeof getLastConfigReloadISO === 'function' ? getLastConfigReloadISO() : null;
      if (iso) (base as any).last_config_reload_iso = iso;
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
