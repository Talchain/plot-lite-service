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
import { registerTemplatesRoutes } from './templates.js';
import { registerLimitsRoute } from './limits.js';
import { registerValidateRoute } from './validate.js';
import { getStreamHealthExtras, p95Ms, getLastRequestAt, getJson429Count, getSse429Count, getLastConfigReloadISO, getLastComputeMs, getEngineP95Ms, getEngineP95MsRolling, getSseOpen, getSseClosed, getSseTimeout } from '../../metrics.js';
import { getFixtureCacheSize, getFixtureCacheStats } from '../../lib/fixtures-cache.js';
import { registerStreamRoute } from './stream.js';
import { registerStreamRouteEnhanced } from './stream-enhanced.js';
import { getIdemStoreSize } from '../../middleware/idempotency.js';
import { authGuard } from '../../middleware/auth-guard.js';
// healthResponseSchema used for OpenAPI documentation

/**
 * Register all /v1 routes
 */
export async function registerV1Routes(app: FastifyInstance) {
  // Add consolidated auth guard hook for all /v1/* routes
  app.addHook('preHandler', async (req, reply) => {
    // Only apply to /v1/* routes
    if (req.url?.startsWith('/v1/')) {
      // Allow demo bypass only for GET /v1/stream
      const isStreamRoute = req.method === 'GET' && req.url.startsWith('/v1/stream');
      await authGuard(req, reply, { allowDemoBypass: isStreamRoute });
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
        try { (payload as any).trace_id = String(trace); } catch { /* ignore */ }
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
  await registerDiffRoute(app);
  await registerScoreRoute(app);
  await registerInterveneRoute(app);
  await registerEvidenceRoute(app);
  await registerSensitivityRoute(app);
  await registerRunBatchRoute(app);
  await registerOptimiseRoute(app);
  await registerPreferencesRoute(app);
  await registerRunBundleRoute(app);
  await registerRunTimeslicesRoute(app);
  await registerKeyInsightRoute(app);
  await registerElicitBeliefRoute(app);
  await registerSuggestUtilityWeightsRoute(app);
  await registerDominanceAnalysisRoute(app);
  await registerParetoAnalysisRoute(app);
  await registerMultiCriteriaAnalysisRoute(app);
  await registerElicitRiskToleranceRoute(app);
  await registerRiskAdjustRoute(app);
  await registerThresholdsRoute(app);
  await registerSuggestEdgeFunctionRoute(app);
  // Phase 4: Sequential graph support
  await registerConditionalRecommendRoute(app);
  await registerSequentialAnalysisRoute(app);
  await registerPolicyTreeRoute(app);
  await registerGenerateRecommendationRoute(app);
  await registerNarrateConditionsRoute(app);
  await registerExplainPolicyRoute(app);
  await registerAnalysisOptimiseRoute(app);
  // Brief 8: Sampling Engine & Caching (ISL robustness analysis)
  await registerSimulateBatchRoute(app);
  await registerAuditTestRoute(app);
  await registerGovernanceRoute(app);  
  // P1: Register enhanced stream route if enabled, otherwise use legacy
  if (process.env.STREAM_PARITY_ENABLE === '1') {
    await registerStreamRouteEnhanced(app);
  } else {
    await registerStreamRoute(app);
  }

  // Health and version at /v1 as well (for consistency)
  // Note: Payload size optimized - removed snapshot() spread to stay under 4 KiB contract
  app.get('/v1/health', async () => {
    const base = {
      status: 'ok',
      api_version: 'v1',
      p95_ms: p95Ms() || 0,
      version: '1.0.0',
      uptime_s: Math.round(process.uptime()),
      last_request_at: getLastRequestAt() || undefined,
      // snapshot() removed - was contributing ~1.5 KiB with all request/stream counters
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
    // Derive high-level health status from latency and rate-limit counters
    try {
      const reasons: string[] = [];
      const budgetMs = Number(process.env.ENGINE_P95_BUDGET_MS || 600);
      const rolling = typeof base.engine_p95_ms_rolling === 'number' ? base.engine_p95_ms_rolling : 0;
      if (rolling > budgetMs && rolling > 0) {
        reasons.push('engine_p95_ms_rolling_exceeded');
      }
      if ((base.json_429_count ?? 0) > 0 || (base.sse_429_count ?? 0) > 0) {
        reasons.push('rate_limit_429');
      }
      base.slo_budget_ms = budgetMs;
      if (reasons.length > 0) {
        base.degraded = true;
        base.health_status = 'degraded';
        base.degraded_reasons = reasons;
      } else {
        base.degraded = false;
        base.health_status = 'ok';
      }
    } catch { /* ignore */ }
    // WP-P3: Circuit breaker stats (flag-gated)
    try {
      const { getCircuitBreakerStats } = await import('../../middleware/circuitBreaker.js');
      const cbStats = getCircuitBreakerStats();
      if (cbStats) base.circuit_breaker = cbStats;
    } catch { /* ignore */ }
    // PR-3: Principal extraction stats
    try {
      const { getPrincipalExtractionStats } = await import('../../lib/extractPrincipal.js');
      base.principal_extraction = getPrincipalExtractionStats();
    } catch { /* ignore */ }
    // Optional environment/build hints for ops triage
    try {
      const env = process.env.ENVIRONMENT;
      if (env) base.environment = env;
    } catch { /* ignore */ }
    try {
      const b = process.env.BUILD_ID_SHORT || '';
      if (b) base.build = b;
    } catch { /* ignore */ }
    try {
      const extras = getStreamHealthExtras();
      if (extras && typeof extras === 'object') {
        for (const [k, v] of Object.entries(extras)) {
          if (typeof v === 'number') base[k] = v;
        }
      }
    } catch { /* ignore */ }
    // Optional last reload timestamp
    try {
      const iso = getLastConfigReloadISO();
      if (iso) base.last_config_reload_iso = iso;
    } catch { /* ignore */ }
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
import { registerEvidenceRoute } from './evidence.js';
import { registerSensitivityRoute } from './sensitivity.js';
import { registerRunBatchRoute } from './run-batch.js';
import { registerOptimiseRoute } from './optimise.js';
import { registerPreferencesRoute } from './preferences.js';
import { registerRunBundleRoute } from './run-bundle.js';
import { registerRunTimeslicesRoute } from './run-timeslices.js';
import { registerAuditTestRoute } from '../test/audit.js';
import { registerGovernanceRoute } from '../test/governance.js';
import { registerDiffRoute } from './diff.js';
import { registerKeyInsightRoute } from './key-insight.js';
import { registerElicitBeliefRoute } from './elicit-belief.js';
import { registerSuggestUtilityWeightsRoute } from './suggest-utility-weights.js';
import { registerDominanceAnalysisRoute } from './analysis-dominance.js';
import { registerParetoAnalysisRoute } from './analysis-pareto.js';
import { registerMultiCriteriaAnalysisRoute } from './analysis-multi-criteria.js';
import { registerElicitRiskToleranceRoute } from './elicit-risk-tolerance.js';
import { registerRiskAdjustRoute } from './analysis-risk-adjust.js';
import { registerThresholdsRoute } from './analysis-thresholds.js';
import { registerSuggestEdgeFunctionRoute } from './suggest-edge-function.js';
// Phase 4: Sequential graph support
import { registerConditionalRecommendRoute } from './analysis-conditional-recommend.js';
import { registerSequentialAnalysisRoute } from './analysis-sequential.js';
import { registerPolicyTreeRoute } from './analysis-policy-tree.js';
import { registerGenerateRecommendationRoute } from './recommend-generate.js';
import { registerNarrateConditionsRoute } from './narrate-conditions.js';
import { registerExplainPolicyRoute } from './explain-policy.js';
import { registerAnalysisOptimiseRoute } from './analysis-optimise.js';
// Brief 8: Sampling Engine & Caching
import { registerSimulateBatchRoute } from './simulate-batch.js';
