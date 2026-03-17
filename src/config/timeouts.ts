/**
 * Centralized timeout configuration.
 *
 * Single source of truth for all service-call timeouts. Every call site
 * imports from here — no inline `Number(process.env.X ?? default)` allowed.
 *
 * Env var precedence: env var → fallback default (defined here).
 */

// -----------------------------------------------------------------------------
// CEE Timeouts
// -----------------------------------------------------------------------------

/** General CEE call timeout (orchestrated review, enrichment, etc.) */
export const CEE_TIMEOUT_MS = Number(process.env.CEE_TIMEOUT_MS || 60_000);

/** CEE decision review (M2 /assist/v1/decision-review) */
export const CEE_DECISION_REVIEW_TIMEOUT_MS =
  Number(process.env.CEE_DECISION_REVIEW_TIMEOUT_MS) || 20_000;

/** CEE draft-graph proxy (/assist/v1/draft-graph — long-running LLM call) */
export const CEE_DRAFT_GRAPH_TIMEOUT_MS = Number(
  process.env.CEE_DRAFT_GRAPH_TIMEOUT_MS || 120_000,
);

/**
 * BFF proxy timeout for CEE draft-graph.
 * Set above CEE_DRAFT_GRAPH_TIMEOUT_MS (120s) so CEE can return its own
 * typed error before PLoT's proxy timer fires.
 *
 * Timeout hierarchy (defaults — all env-var overridable):
 *   CEE_TIMEOUT_MS:                60 000ms — general CEE calls
 *   CEE_DRAFT_GRAPH_TIMEOUT_MS:   120 000ms — LLM draft-graph budget
 *   CEE_PROXY_TIMEOUT_MS:         135 000ms — BFF proxy wrapper (must exceed CEE budget)
 *   FASTIFY_REQUEST_TIMEOUT_MS:   180 000ms — Fastify connection timeout (must exceed proxy)
 *
 * Production values must satisfy: DRAFT_GRAPH < PROXY < FASTIFY_REQUEST.
 * Parsed with parseInt; falls back to 135 000ms if env var is missing or invalid.
 */
const _parsedProxyTimeout = parseInt(process.env.CEE_PROXY_TIMEOUT_MS ?? '', 10);
export const CEE_PROXY_TIMEOUT_MS =
  Number.isFinite(_parsedProxyTimeout) && _parsedProxyTimeout > 0
    ? _parsedProxyTimeout
    : 135_000;

/** CEE proxy: graph-readiness */
export const CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS =
  Number(process.env.CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS) || 10_000;

/** CEE proxy: bias-check */
export const CEE_PROXY_BIAS_CHECK_TIMEOUT_MS =
  Number(process.env.CEE_PROXY_BIAS_CHECK_TIMEOUT_MS) || 60_000;

/** CEE proxy: sensitivity-coach */
export const CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS =
  Number(process.env.CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS) || 60_000;

/** CEE proxy: prompts/warm */
export const CEE_PROXY_PROMPTS_WARM_TIMEOUT_MS =
  Number(process.env.CEE_PROXY_PROMPTS_WARM_TIMEOUT_MS) || 10_000;

// -----------------------------------------------------------------------------
// ISL Timeouts
// -----------------------------------------------------------------------------

/** ISL request timeout */
export const ISL_TIMEOUT_MS =
  Number(process.env.ISL_REQUEST_TIMEOUT_MS || process.env.ISL_TIMEOUT_MS) || 30_000;

/** ISL health-check timeout */
export const ISL_HEALTH_CHECK_TIMEOUT_MS =
  Number(process.env.ISL_HEALTH_CHECK_TIMEOUT_MS) || 5_000;

/** ISL threshold analysis: maximum per-call timeout cap */
export const ISL_THRESHOLDS_TIMEOUT_MS_CAP =
  Number(process.env.ISL_THRESHOLDS_TIMEOUT_MS_CAP) || 10_000;

/** ISL threshold analysis: minimum remaining request budget to attempt call */
export const THRESHOLDS_MIN_REMAINING_BUDGET_MS =
  Number(process.env.THRESHOLDS_MIN_REMAINING_BUDGET_MS) || 5_000;

/** Overall request budget for /v2/run (used for threshold budget gating) */
export const REQUEST_BUDGET_MS =
  Number(process.env.REQUEST_BUDGET_MS) || 60_000;

// -----------------------------------------------------------------------------
// Fastify server timeout
// -----------------------------------------------------------------------------

/**
 * Fastify requestTimeout — the outermost timeout in the chain.
 * Must exceed CEE_PROXY_TIMEOUT_MS so proxy routes can return typed errors
 * before Fastify kills the connection.
 *
 * Chain: CEE LLM call < CEE route timeout < PLoT proxy timeout < Fastify requestTimeout < Render gateway
 */
export const FASTIFY_REQUEST_TIMEOUT_MS = Number(
  process.env.FASTIFY_REQUEST_TIMEOUT_MS || 180_000,
);

// -----------------------------------------------------------------------------
// Startup logging & validation
// -----------------------------------------------------------------------------

/** Log all resolved timeout values. Call once at startup. */
export function logResolvedTimeouts(): void {
  console.log('[STARTUP] Resolved timeouts (ms):', {
    FASTIFY_REQUEST_TIMEOUT_MS,
    CEE_TIMEOUT_MS,
    CEE_DECISION_REVIEW_TIMEOUT_MS,
    CEE_DRAFT_GRAPH_TIMEOUT_MS,
    CEE_PROXY_TIMEOUT_MS,
    CEE_PROXY_GRAPH_READINESS_TIMEOUT_MS,
    CEE_PROXY_BIAS_CHECK_TIMEOUT_MS,
    CEE_PROXY_SENSITIVITY_COACH_TIMEOUT_MS,
    CEE_PROXY_PROMPTS_WARM_TIMEOUT_MS,
    ISL_TIMEOUT_MS,
    ISL_HEALTH_CHECK_TIMEOUT_MS,
    ISL_THRESHOLDS_TIMEOUT_MS_CAP,
    THRESHOLDS_MIN_REMAINING_BUDGET_MS,
    REQUEST_BUDGET_MS,
  });
}

/**
 * Validate the timeout chain ordering invariant at startup.
 * Logs warnings for violations — does NOT block startup.
 *
 * Required chain: FASTIFY_REQUEST_TIMEOUT_MS > CEE_PROXY_TIMEOUT_MS > CEE_DRAFT_GRAPH_TIMEOUT_MS
 */
export function validateTimeoutChain(): boolean {
  const violations: string[] = [];

  if (FASTIFY_REQUEST_TIMEOUT_MS <= CEE_PROXY_TIMEOUT_MS) {
    violations.push(
      `FASTIFY_REQUEST_TIMEOUT_MS (${FASTIFY_REQUEST_TIMEOUT_MS}) must be > CEE_PROXY_TIMEOUT_MS (${CEE_PROXY_TIMEOUT_MS})`,
    );
  }

  if (CEE_PROXY_TIMEOUT_MS <= CEE_DRAFT_GRAPH_TIMEOUT_MS) {
    violations.push(
      `CEE_PROXY_TIMEOUT_MS (${CEE_PROXY_TIMEOUT_MS}) must be > CEE_DRAFT_GRAPH_TIMEOUT_MS (${CEE_DRAFT_GRAPH_TIMEOUT_MS})`,
    );
  }

  if (violations.length > 0) {
    console.warn('[STARTUP] ⚠ Timeout chain violation(s):');
    for (const v of violations) {
      console.warn(`  - ${v}`);
    }
    return false;
  }

  console.log('[STARTUP] ✓ Timeout chain valid:', {
    FASTIFY_REQUEST_TIMEOUT_MS,
    CEE_PROXY_TIMEOUT_MS,
    CEE_DRAFT_GRAPH_TIMEOUT_MS,
  });
  return true;
}
