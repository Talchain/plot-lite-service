import pino from 'pino';
import { ISL_TIMEOUT_MS, CEE_TIMEOUT_MS, worstCaseMs, resolveIslMaxRetries } from './config/timeouts.js';
import { getExpectedAuthToken } from './config/auth-token.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

export function validateEnv(): void {
  const errors: string[] = [];

  // AUTH validation — a flip to AUTH_ENABLED=1 must have an expected token from
  // the single resolved source (PLOT_AUTH_TOKEN, or the historical AUTH_TOKEN
  // fallback). Without this reconciliation the boot would exit(1) on staging,
  // where only PLOT_AUTH_TOKEN is provisioned — a boot crash strictly worse than
  // the 403 this change exists to prevent. Fires only when AUTH_ENABLED=1 → inert
  // until the flip.
  if (process.env.AUTH_ENABLED === '1' && !getExpectedAuthToken()) {
    errors.push('AUTH_ENABLED=1 requires AUTH_TOKEN or PLOT_AUTH_TOKEN to be set');
  }

  // PORT validation
  const portStr = process.env.PORT || '4311';
  const port = Number(portStr);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: ${portStr} (must be 1-65535)`);
  }

  // FASTIFY_REQUEST_TIMEOUT_MS validation (must sit above CEE_PROXY_TIMEOUT_MS in the timeout chain)
  if (process.env.FASTIFY_REQUEST_TIMEOUT_MS) {
    const timeout = Number(process.env.FASTIFY_REQUEST_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 1000 || timeout > 600000) {
      errors.push(`Invalid FASTIFY_REQUEST_TIMEOUT_MS: ${process.env.FASTIFY_REQUEST_TIMEOUT_MS} (must be 1000-600000)`);
    }
  }

  // RATE_LIMIT_RPM validation
  if (process.env.RATE_LIMIT_RPM) {
    const rpm = Number(process.env.RATE_LIMIT_RPM);
    if (isNaN(rpm) || rpm < 1) {
      errors.push(`Invalid RATE_LIMIT_RPM: ${process.env.RATE_LIMIT_RPM} (must be >= 1)`);
    }
  }

  // RATE_LIMIT_PER_MIN validation (legacy)
  if (process.env.RATE_LIMIT_PER_MIN) {
    const rpm = Number(process.env.RATE_LIMIT_PER_MIN);
    if (isNaN(rpm) || rpm < 1) {
      errors.push(`Invalid RATE_LIMIT_PER_MIN: ${process.env.RATE_LIMIT_PER_MIN} (must be >= 1)`);
    }
  }

  // CORS_ORIGINS validation
  if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    for (const origin of origins) {
      try {
        new URL(origin);
      } catch {
        errors.push(`Invalid CORS_ORIGINS entry: "${origin}" (must be valid URL)`);
      }
    }
  }

  // STREAM_HEARTBEAT_SEC validation
  if (process.env.STREAM_HEARTBEAT_SEC) {
    const hb = Number(process.env.STREAM_HEARTBEAT_SEC);
    if (isNaN(hb) || hb < 1) {
      errors.push(`Invalid STREAM_HEARTBEAT_SEC: ${process.env.STREAM_HEARTBEAT_SEC} (must be >= 1)`);
    }
  }

  // SCM_LITE validation
  if (process.env.SCM_LITE_K) {
    const k = Number(process.env.SCM_LITE_K);
    if (isNaN(k) || k < 10 || k > 10000) {
      errors.push(`Invalid SCM_LITE_K: ${process.env.SCM_LITE_K} (must be 10-10000)`);
    }
  }
  if (process.env.SCM_LITE_MAX_NODES) {
    const max = Number(process.env.SCM_LITE_MAX_NODES);
    if (isNaN(max) || max < 2 || max > 50) {
      errors.push(`Invalid SCM_LITE_MAX_NODES: ${process.env.SCM_LITE_MAX_NODES} (must be 2-50)`);
    }
  }
  if (process.env.SCM_LITE_BELIEF_DEFAULT) {
    const belief = Number(process.env.SCM_LITE_BELIEF_DEFAULT);
    if (isNaN(belief) || belief < 0 || belief > 1) {
      errors.push(`Invalid SCM_LITE_BELIEF_DEFAULT: ${process.env.SCM_LITE_BELIEF_DEFAULT} (must be 0-1)`);
    }
  }

  // P1.4: Timeout configuration validation (60s allowed for staging integration testing)
  if (process.env.CEE_TIMEOUT_MS) {
    const timeout = Number(process.env.CEE_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 500 || timeout > 120000) {
      errors.push(`Invalid CEE_TIMEOUT_MS: ${process.env.CEE_TIMEOUT_MS} (must be 500-120000)`);
    }
  }
  // ISL timeout: allow up to 180s for complex robustness analysis operations
  if (process.env.ISL_TIMEOUT_MS) {
    const timeout = Number(process.env.ISL_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 1000 || timeout > 180000) {
      errors.push(`Invalid ISL_TIMEOUT_MS: ${process.env.ISL_TIMEOUT_MS} (must be 1000-180000)`);
    }
  }
  if (process.env.SSE_MAX_MS) {
    const timeout = Number(process.env.SSE_MAX_MS);
    if (isNaN(timeout) || timeout < 10000 || timeout > 300000) {
      errors.push(`Invalid SSE_MAX_MS: ${process.env.SSE_MAX_MS} (must be 10000-300000)`);
    }
  }
  if (process.env.CEE_CB_HALF_OPEN_TIMEOUT_MS) {
    const timeout = Number(process.env.CEE_CB_HALF_OPEN_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 1000 || timeout > 120000) {
      errors.push(`Invalid CEE_CB_HALF_OPEN_TIMEOUT_MS: ${process.env.CEE_CB_HALF_OPEN_TIMEOUT_MS} (must be 1000-120000)`);
    }
  }
  if (process.env.RL_CB_HALF_OPEN_TIMEOUT_MS) {
    const timeout = Number(process.env.RL_CB_HALF_OPEN_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 1000 || timeout > 120000) {
      errors.push(`Invalid RL_CB_HALF_OPEN_TIMEOUT_MS: ${process.env.RL_CB_HALF_OPEN_TIMEOUT_MS} (must be 1000-120000)`);
    }
  }
  if (process.env.CEE_DECISION_REVIEW_TIMEOUT_MS) {
    const timeout = Number(process.env.CEE_DECISION_REVIEW_TIMEOUT_MS);
    if (isNaN(timeout) || timeout < 1000 || timeout > 300000) {
      errors.push(`Invalid CEE_DECISION_REVIEW_TIMEOUT_MS: ${process.env.CEE_DECISION_REVIEW_TIMEOUT_MS} (must be 1000-300000)`);
    }
  }
  // CEE proxy endpoint timeouts
  for (const envVar of [
    'CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS',
    'CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS',
  ]) {
    if (process.env[envVar]) {
      const timeout = Number(process.env[envVar]);
      if (isNaN(timeout) || timeout < 1000 || timeout > 300000) {
        errors.push(`Invalid ${envVar}: ${process.env[envVar]} (must be 1000-300000)`);
      }
    }
  }

  // ISL_MAX_RETRIES validation
  if (process.env.ISL_MAX_RETRIES) {
    const retries = Number(process.env.ISL_MAX_RETRIES);
    if (isNaN(retries) || retries < 0 || retries > 5) {
      errors.push(`Invalid ISL_MAX_RETRIES: ${process.env.ISL_MAX_RETRIES} (must be 0-5)`);
    }
  }

  // P0.1: Combined timeout budget validation
  // Ensure worst-case latency fits within proxy timeout
  // Default 600s (10 min) to accommodate long-running ISL/CEE operations with retries
  const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || '600000');
  // Paul-ruled lenient defaults 2026-07-17: derive the resolved values from
  // config/timeouts.ts instead of hand-mirroring defaults here — the mirrors
  // had already drifted (15000 vs the real 30000 ISL default, 5000 vs the real
  // 60000 CEE default), so this warn was doing its arithmetic on a codebase
  // that didn't exist.
  const islTimeoutMs = ISL_TIMEOUT_MS;
  // De-mirrored 2026-07-18: the ISL_MAX_RETRIES default '3' now derives from the
  // single source in config/timeouts.ts (was hand-written here AND in isl/client.ts).
  const islMaxRetries = resolveIslMaxRetries();
  const ceeTimeoutMs = CEE_TIMEOUT_MS;
  const computeBudgetMs = Number(process.env.MAX_COMPUTE_MS || '10000');

  // ISL worst-case: attempts × per-attempt timeout PLUS the 1s+2s… backoff slept
  // between them. The comment said "with exponential backoff" but the previous
  // formula (islTimeoutMs × islMaxRetries) omitted it; worstCaseMs is now the
  // single honest source shared with the /v2/run base-call clamp + telemetry.
  const islWorstCaseMs = worstCaseMs(islMaxRetries, islTimeoutMs);

  // Total worst-case: max(ISL, CEE) + compute
  const totalWorstCaseMs = Math.max(islWorstCaseMs, ceeTimeoutMs) + computeBudgetMs;

  if (totalWorstCaseMs > PROXY_TIMEOUT_MS) {
    logger.warn({
      islTimeoutMs,
      islMaxRetries,
      islWorstCaseMs,
      ceeTimeoutMs,
      computeBudgetMs,
      totalWorstCaseMs,
      proxyTimeoutMs: PROXY_TIMEOUT_MS,
    }, `Combined timeout budget (${totalWorstCaseMs}ms) exceeds proxy timeout (${PROXY_TIMEOUT_MS}ms). Consider reducing ISL_TIMEOUT_MS, ISL_MAX_RETRIES, or MAX_COMPUTE_MS.`);
  }

  if (errors.length > 0) {
    logger.fatal({ errors, env: process.env.NODE_ENV }, 'Environment validation failed');
    // Also log to stderr for visibility during startup
    process.stderr.write('\n❌ ENVIRONMENT VALIDATION FAILED:\n');
    errors.forEach(err => process.stderr.write(`  - ${err}\n`));
    process.stderr.write('\nPlease fix the above errors and restart the server.\n');
    process.exit(1);
  }

  logger.info({ 
    port: Number(portStr), 
    nodeEnv: process.env.NODE_ENV || 'development',
    authEnabled: process.env.AUTH_ENABLED === '1',
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== '0',
    testRoutes: process.env.TEST_ROUTES === '1',
  }, 'Environment validation passed');
}
