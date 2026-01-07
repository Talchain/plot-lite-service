/**
 * Health, readiness, liveness, and version endpoints
 * Extracted from createServer.ts for maintainability
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spawnSync } from 'child_process';
import {
  p95Ms,
  p99Ms,
  eventLoopDelayMs,
  snapshot,
  replaySnapshot,
} from '../metrics.js';
import { getCeeCircuitBreakerStats } from '../cee/circuit-breaker.js';
import { WEIGHT_SCHEMAS, DEFAULT_WEIGHT_SCHEMA, type WeightSchemaVersion } from '../engine/weight-schema.js';
import { getBeliefSpreadCapability, CURRENT_BELIEF_SPREAD_VERSION } from '../engine/belief-spread.js';

export interface HealthRoutesOptions {
  enableTestRoutes?: boolean;
  idemCacheSize: () => number;
  getReadinessStatus: () => boolean;
}

// Cached build ID to avoid per-request git calls
let cachedBuildId: string | null = null;

function getBuildId(): string {
  if (cachedBuildId !== null) return cachedBuildId;

  // Prefer env vars from CI/CD (set at build/deploy time)
  const envBuildId = process.env.BUILD_ID || process.env.GITHUB_SHA;
  if (envBuildId) {
    cachedBuildId = envBuildId.slice(0, 7);
    return cachedBuildId;
  }

  // Fallback to git (one-time only, typically in dev)
  try {
    const res = spawnSync('git', ['--no-pager', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    if (res.status === 0) {
      cachedBuildId = res.stdout.trim() || new Date().toISOString();
      return cachedBuildId;
    }
  } catch { /* ignore */ }

  cachedBuildId = new Date().toISOString();
  return cachedBuildId;
}

export async function registerHealthRoutes(app: FastifyInstance, opts: HealthRoutesOptions) {
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

  // Main health endpoint with metrics
  app.get('/health', async () => {
    // Metrics already imported statically
    const { rateLimitState } = await import('../rateLimit.js');
    const mem = process.memoryUsage();
    const build = getBuildId();
    const base = {
      status: 'ok' as const,
      build,  // Added for deployment verification
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
        idempotency_current: opts.idemCacheSize(),
      },
      rate_limit: rateLimitState(),
      cee_circuit_breaker: getCeeCircuitBreakerStats(),
      test_routes_enabled: process.env.NODE_ENV === 'production' ? false : (process.env.TEST_ROUTES === '1'),
      replay: replaySnapshot(),
      // Dev-only documentation of defaults for CI drift checks (add-only)
      ...(process.env.NODE_ENV === 'production' ? {} : {
        flags_doc: {
          'test_routes_enabled': false,
          'rate_limit.enabled': true,
        }
      }),
    } as const;
    // Enforce a small upper bound to prevent accidental drift; keep required keys
    const MAX_BYTES = 4 * 1024;
    const txt = JSON.stringify(base);
    if (Buffer.byteLength(txt, 'utf8') <= MAX_BYTES) return base;
    const minimal = {
      status: 'ok' as const,
      p95_ms: p95Ms(),
      test_routes_enabled: process.env.NODE_ENV === 'production' ? false : Boolean(opts.enableTestRoutes || process.env.TEST_ROUTES === '1'),
      replay: replaySnapshot(),
    };
    return minimal;
  });

  // Version and feature flags
  app.get('/version', async () => {
    const build = getBuildId();
    // C7: Expose feature flags for ops visibility
    const flags = {
      SCM_LITE_ENABLE: process.env.SCM_LITE_ENABLE === '1' ? 'ON' : 'OFF',
      IDENT_TAG_ENABLE: process.env.IDENT_TAG_ENABLE === '1' ? 'ON' : 'OFF',
      PROVENANCE_ENABLE: process.env.PROVENANCE_ENABLE === '1' ? 'ON' : 'OFF',
      ADAPTIVE_K_ENABLE: process.env.ADAPTIVE_K_ENABLE === '1' ? 'ON' : 'OFF',
      CONFIDENCE_CALIBRATED: process.env.CONFIDENCE_CALIBRATED === '1' ? 'ON' : 'OFF',
      PROMETHEUS_ENABLE: process.env.PROMETHEUS_ENABLE === '1' ? 'ON' : 'OFF',
      OPS_SNAPSHOT_ENABLE: process.env.OPS_SNAPSHOT_ENABLE === '1' ? 'ON' : 'OFF',
      RL_CB_ENABLE: process.env.RL_CB_ENABLE === '1' ? 'ON' : 'OFF',
      SSE_MAX_MS: process.env.SSE_MAX_MS || '120000',
      AUTH_ENABLED: process.env.AUTH_ENABLED === '1' ? 'ON' : 'OFF',
      ISL_ENABLE: process.env.ISL_ENABLE === '1' ? 'ON' : 'OFF',
    };
    // Capabilities: advertise supported features for client capability negotiation
    const capabilities = {
      detail_level: ['quick', 'standard', 'deep'] as const,
      inference_mode: ['model_based', 'model_of_inference'] as const,
      streaming: process.env.STREAM_PARITY_ENABLE === '1' ? 'enhanced' : 'legacy',
      isl_integration: process.env.ISL_ENABLE === '1',
      max_recommended_latency_ms: 25000, // Hint for clients about proxy timeouts
      // Phase 2: Weight schema versioning (Task 2.1)
      weight_schema: {
        default_version: DEFAULT_WEIGHT_SCHEMA,
        supported_versions: Object.keys(WEIGHT_SCHEMAS) as WeightSchemaVersion[],
        schemas: WEIGHT_SCHEMAS,
      },
      // Phase 2: Belief→spread mapping (Task 2.2)
      belief_spread: getBeliefSpreadCapability(),
    };
    return {
      api: 'warp/0.1.0',
      build,
      model: `plot-lite-${build}`,
      version: '1.5.0', // Package version for explicit tracking
      flags,
      capabilities,
    };
  });

  // Readiness: only 200 when fixtures are preloaded
  app.get('/ready', async (_req: FastifyRequest, reply: FastifyReply) => {
    const ready = opts.getReadinessStatus();
    return reply.code(ready ? 200 : 503).send({ ok: ready });
  });

  // Liveness probe — basic process up indicator
  app.get('/live', async () => ({ ok: true }));
}
