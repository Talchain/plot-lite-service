/**
 * Health, readiness, liveness, and version endpoints
 * Extracted from createServer.ts for maintainability
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBuildId } from '../util/build-id.js';
import {
  p95Ms,
  p99Ms,
  eventLoopDelayMs,
  snapshot,
  replaySnapshot,
} from '../metrics.js';
import { getExpectedAuthToken, getStagedAuthToken } from '../config/auth-token.js';
import { getCeeCircuitBreakerStats } from '../cee/circuit-breaker.js';
import { getIslCircuitBreakerStats } from '../integrations/isl-circuit-breaker.js';
import { getRouteCallerSnapshot } from '../observability/routeCallerTelemetry.js';
import { WEIGHT_SCHEMAS, DEFAULT_WEIGHT_SCHEMA, type WeightSchemaVersion } from '../engine/weight-schema.js';
import { getBeliefSpreadCapability } from '../engine/belief-spread.js';
// The contract-health manifest, published on /health. Imported from the
// RUNTIME-RESOLVED module, never derived from the package.json pin — see the
// block at the /health return for why that distinction is the whole point.
import {
  SCHEMA_PACKAGE_VERSION,
  SCHEMA_SHA,
  CONTRACT_MANIFEST_SHA,
} from '@talchain/schemas';

export interface HealthRoutesOptions {
  enableTestRoutes?: boolean;
  idemCacheSize: () => number;
  getReadinessStatus: () => boolean;
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
      // Bearer rotation state. PRESENCE BOOLEANS ONLY — never a value, never a
      // length, never a prefix. `staged: true` means a rotation is in progress;
      // the authoritative "is it safe to delete ACTIVE yet" signal is the
      // plot_engine_auth_token_match_total counter on /metrics, not this.
      auth_secrets: {
        active: Boolean(getExpectedAuthToken()),
        staged: Boolean(getStagedAuthToken()),
      },
      cee_circuit_breaker: getCeeCircuitBreakerStats(),
      // ROADMAP 1.209: the ISL breaker's state was surfaced NOWHERE, while the
      // CEE breaker beside it was published — so a reader would reasonably infer
      // ISL simply had no breaker, rather than a dead one. Now visible, with
      // `enforcing` stating plainly whether it is allowed to act.
      isl_circuit_breaker: {
        ...getIslCircuitBreakerStats(),
        enforcing: process.env.ISL_CB_ENFORCE === '1',
      },
      test_routes_enabled: process.env.NODE_ENV === 'production' ? false : (process.env.TEST_ROUTES === '1'),
      replay: replaySnapshot(),
      // D-PLoT evidence (arch step 1): per-route × caller-class request counts,
      // so a "zero calls in N days" claim can be READ from outside the process
      // instead of asserted. Fixed-size by construction — see
      // src/observability/routeCallerTelemetry.ts; the /health 4 KiB budget
      // enforced below must never be what decides whether this is present.
      route_callers: getRouteCallerSnapshot(),
      // ⭐ THE CONTRACT THIS BOX IS ACTUALLY RUNNING — published because
      // SCHEMA-VERSION SKEW IS THIS ESTATE'S DOMINANT CROSS-CUTTING RISK AND
      // WAS, UNTIL THIS FIELD, UNMEASURABLE FROM OUTSIDE THE BOX.
      //
      // `CLAUDE.md` states the risk: each repo pins its own `@talchain/schemas`,
      // the versions drift, and a consumer on an older version SILENTLY DROPS
      // fields it does not know — coaching, evidence and enrichment have all
      // been lost this way. A value that validates at the producer vanishes at
      // the consumer with no error anywhere.
      //
      // CEE published these four on /healthz first (#1606, live on staging).
      // PLoT is the SECOND of two comparable producers, which is what makes
      // `compareHealthManifest` usable across the CEE→PLoT hop at all: one
      // producer can only ever be compared with itself.
      //
      // ⚠ THE RUNTIME-RESOLVED VERSION, NOT THE PIN. `package.json:86` is a
      // DECLARATION; the loaded module is the FACT, and they diverge exactly
      // when it matters — a stale `node_modules`, a hoisted duplicate, a
      // vendored tarball re-cut under the same version string. This repo's
      // `@talchain/schemas` IS a vendored tarball, and the divergence is live
      // TODAY: the vendored 0.55.0 carries `CONTRACT_MANIFEST_SHA = 088fb46a…`
      // while olumi-schemas `main`, also calling itself 0.55.0, carries
      // `4d3b0995…`. One version string, two adoption manifests — precisely
      // the case these digests exist to catch, and one a pin-derived value
      // could never see.
      //
      // ⚠ NOT NESTED, DELIBERATELY. The four keys and their names are fixed by
      // the contract (`@talchain/schemas` `HEALTH_MANIFEST_FIELDS`): "a nested
      // object is easy to add and easy for a load balancer / smoke test to
      // never look at. Top-level fields sit next to `build` and get read."
      // `parseHealthManifest()` parses them `.strict()`, so a typo fails
      // loudly instead of being silently ignored.
      //
      // ⚠ NAMED APART FROM THIS REPO'S EXISTING `*_schema_version` FIELDS, NOT
      // ALIGNED WITH THEM (CLAUDE.md trap 21). `request_schema_version: 'v3'`,
      // `review_pass_schema_version: 1`, `weight_schema`/`edge_schema_version`
      // and `facts_schema_version` are per-domain FORMAT LABELS, and /version's
      // `version: '1.5.0'` is PLoT's own package version. None of them is a
      // contract package version. These four answer a different question and
      // must never be reconciled with those.
      //
      // Non-secret by construction: a semver string and two sha256 digests over
      // PUBLIC contract bytes. Never a key, a host, a path or a magnitude.
      // `/health` is unauthenticated by declaration (contracts/openapi.yaml:64
      // `security: []`) and by measurement (staging returns 200 with no bearer,
      // while `/v1/health` returns 401), so this was weighed as public output.
      schema_write_version: SCHEMA_PACKAGE_VERSION,
      // DELIBERATELY CONSERVATIVE: exactly what this service writes. PLoT's
      // boundary schemas are tolerant-additive and would in practice read more
      // than one release line, but a wider claim is one this change cannot
      // substantiate, and this field is the input to `compareHealthManifest`'s
      // reader-first deploy gate — a writer may only be promoted once every
      // downstream reader lists its release line. An unearned entry would
      // silently WIDEN that gate. Widen it only with evidence, per version.
      schema_read_versions: [SCHEMA_PACKAGE_VERSION],
      schema_sha: SCHEMA_SHA,
      contract_manifest_sha: CONTRACT_MANIFEST_SHA,
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
      // Kept in the degraded payload too: this is the D-PLoT removal evidence,
      // and silently dropping it under budget pressure would turn "no calls
      // recorded" into "no counter present" without anyone noticing.
      route_callers: getRouteCallerSnapshot(),
      // ⭐ KEPT IN THE DEGRADED PAYLOAD TOO — the same argument as
      // `route_callers` above, and it is the reason this is not a copy-paste of
      // CEE's /healthz change. `parseHealthManifest()` throws on ANY missing
      // key, so emitting these four only in the full payload would make them
      // VANISH ENTIRELY at the first budget overflow — and every reader would
      // then read "this producer is broken" rather than "this producer
      // degraded". Partial emission is indistinguishable from a broken
      // producer, which is exactly the failure mode the manifest exists to
      // detect. Four fields, ~238 bytes; headroom measured at 2,475 bytes
      // against live staging, so this is about the future, not the present.
      // Forced and asserted in tests/health.contract-manifest.test.ts.
      schema_write_version: SCHEMA_PACKAGE_VERSION,
      schema_read_versions: [SCHEMA_PACKAGE_VERSION],
      schema_sha: SCHEMA_SHA,
      contract_manifest_sha: CONTRACT_MANIFEST_SHA,
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
