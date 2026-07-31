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

/**
 * ISL request timeout.
 *
 * Paul-ruled lenient defaults 2026-07-17: raised 30_000 → 60_000. Paul's
 * ruling: better to learn something is slow than have analysis cut off —
 * prioritise analysis quality and scientific credibility. 60s accommodates
 * ISL's own internal leniency raises (parallel ISL lane) plus the measured
 * worst-fit dense-graph base call at the raised depth/complexity budget
 * (A3 budget-scout: ~15-17s staging at K=10000/30M — inside 30s but without
 * margin once ISL's raised internal budgets stack on top). Sits within the
 * derived caller envelope: UI /v2 adapter 120s is the BINDING hop (Render's
 * platform cap is 100 minutes, never binding). NOTE: CEE's non-brief
 * PLOT_RUN_TIMEOUT_MS is 30s — a CALLER ASK to raise it is recorded in the
 * lane-5 PR; until then CEE non-brief runs cannot benefit from the full 60s.
 */
export const ISL_TIMEOUT_MS =
  Number(process.env.ISL_REQUEST_TIMEOUT_MS || process.env.ISL_TIMEOUT_MS) || 60_000;

/** ISL health-check timeout */
export const ISL_HEALTH_CHECK_TIMEOUT_MS =
  Number(process.env.ISL_HEALTH_CHECK_TIMEOUT_MS) || 5_000;

/**
 * ISL threshold analysis: maximum per-call timeout cap.
 *
 * Paul-ruled lenient defaults 2026-07-17: raised 10_000 → 30_000. Still
 * min()-ed at the call site against (remaining request budget − 1s safety
 * margin), so the effective timeout can never outlive the request budget —
 * the raise only stops the CAP from truncating threshold analysis when
 * budget remains.
 */
export const ISL_THRESHOLDS_TIMEOUT_MS_CAP =
  Number(process.env.ISL_THRESHOLDS_TIMEOUT_MS_CAP) || 30_000;

/** ISL threshold analysis: minimum remaining request budget to attempt call */
export const THRESHOLDS_MIN_REMAINING_BUDGET_MS =
  Number(process.env.THRESHOLDS_MIN_REMAINING_BUDGET_MS) || 5_000;

/**
 * Overall request budget for /v2/run (used for threshold + flip-search
 * budget gating).
 *
 * Paul-ruled lenient defaults 2026-07-17: raised 60_000 → 70_000, ≤58% of
 * the BINDING caller bound — the UI /v2 adapter's 120s client timeout
 * (verified at the bytes; Render's platform cap is 100 minutes and never
 * binds). An internal budget that outlives the caller delivers nothing —
 * this is deliberately NOT raised nearer 120s while the CEE non-brief
 * caller sits at 30s (CALLER ASK recorded in the lane-5 PR).
 */
export const REQUEST_BUDGET_MS =
  Number(process.env.REQUEST_BUDGET_MS) || 70_000;

/**
 * Resolve the request budget at CALL TIME, honouring a runtime `REQUEST_BUDGET_MS`
 * env override.
 *
 * `REQUEST_BUDGET_MS` above is evaluated ONCE at module load (used for startup
 * logging and the value-pin tests). The /v2/run call sites need the LIVE env
 * value so an override set after import — e.g. a test forcing budget exhaustion
 * with `process.env.REQUEST_BUDGET_MS = '1'` — actually takes effect. This
 * consolidates the two identical `Number(process.env.REQUEST_BUDGET_MS) ||
 * REQUEST_BUDGET_MS` expressions that previously sat inline in run.ts (a
 * one-liner shared here rather than "just REQUEST_BUDGET_MS", which would
 * silently drop the documented runtime-override capability).
 */
export function resolveRequestBudgetMs(): number {
  return Number(process.env.REQUEST_BUDGET_MS) || REQUEST_BUDGET_MS;
}

// -----------------------------------------------------------------------------
// ISL retry policy (single source of truth)
// -----------------------------------------------------------------------------

/**
 * Default TOTAL ISL attempts (initial try + retries) — the `for (attempt = 1;
 * attempt <= maxRetries; attempt++)` bound in isl/client.ts.
 *
 * De-mirrored 2026-07-18: this `3` was hand-written in BOTH isl/client.ts
 * (`parseInt(process.env.ISL_MAX_RETRIES ?? '3', 10)`) and config-validator.ts
 * (`Number(process.env.ISL_MAX_RETRIES || '3')`). A single constant so the two
 * cannot silently drift. (The ISL timeouts were already de-mirrored here; this
 * default was the one left behind.)
 */
export const ISL_MAX_RETRIES_DEFAULT = 3;

/**
 * TOTAL ISL attempts (no retry) for an OPTIONAL, post-base-science phase —
 * the flip-probe (Codex F3) and threshold (Codex F9) calls. These run AFTER a
 * completed base result, so a retry storm would spend the request budget (and
 * discard the base science) for a phase whose failure is safely
 * degrade-and-disclose. `1` = one try, no retry; named here (rather than a bare
 * literal at the two call sites) so the policy has one home next to
 * {@link ISL_MAX_RETRIES_DEFAULT}.
 */
export const OPTIONAL_PHASE_MAX_RETRIES = 1;

/** Resolve the ISL attempt cap from `ISL_MAX_RETRIES` (default {@link ISL_MAX_RETRIES_DEFAULT}). */
export function resolveIslMaxRetries(): number {
  return parseInt(process.env.ISL_MAX_RETRIES ?? String(ISL_MAX_RETRIES_DEFAULT), 10);
}

/**
 * Floor on any per-attempt ISL timeout derived from a shrinking budget.
 *
 * ROADMAP 2.202 fix ①b — DE-MIRRORED. This `1_000` was a function-local literal
 * in `/v2/run`'s base-call clamp (`const BASE_CALL_MIN_TIMEOUT_MS = 1_000`), and
 * fix ①b needs the SAME floor at a second seam (the retry decision's rescue
 * clamp, `integrations/isl/retry-budget.ts`). Two hand-written copies of a bound
 * that must agree is the dominant defect class this programme names (trap 12), so
 * it gets one home here and both seams import it.
 *
 * Meaning at each seam, and they differ — read both before changing the number:
 *   • `/v2/run` FIRST attempt: a `Math.max` FLOOR. The first attempt is allowed to
 *     exceed a tiny remaining budget rather than be given an unusable timeout.
 *   • retry-budget RESCUE attempt: a VIABILITY THRESHOLD, never a `Math.max`. A
 *     rescue attempt is granted only when the affordable timeout reaches this
 *     value, and it is granted with the AFFORDABLE timeout — flooring UP there
 *     would start an attempt that outlives the caller's budget, which is the one
 *     invariant 2.202 must not break.
 */
export const BASE_CALL_MIN_TIMEOUT_MS = 1_000;

/**
 * Exponential-backoff constants for ISL retries. isl/client.ts sleeps
 * `min(BASE · 2^(attempt-1), CAP)` AFTER each failed non-final attempt. Kept
 * here as the single source shared with the worst-case accounting below.
 */
export const ISL_RETRY_BACKOFF_BASE_MS = 1_000;
export const ISL_RETRY_BACKOFF_CAP_MS = 5_000;

/** Backoff slept after attempt `attempt` (1-indexed) before the next try. */
export function islRetryBackoffMs(attempt: number): number {
  return Math.min(ISL_RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt - 1), ISL_RETRY_BACKOFF_CAP_MS);
}

/**
 * HONEST worst-case wall time for `attempts` sequential ISL attempts, each
 * bounded by `perAttemptTimeoutMs`:
 *
 *   attempts × perAttemptTimeoutMs  +  Σ backoff slept BETWEEN them
 *                                       (i = 1 .. attempts-1)
 *
 * The previous accounting (`attempts × perAttemptTimeoutMs`) OMITTED the 1s+2s…
 * backoff the client actually sleeps — config-validator's comment even claimed
 * "with exponential backoff" while its arithmetic did not include it, and the
 * /v2/run base-call clamp + its telemetry + their test each repeated the same
 * omission. Centralised here so every one of those sites DERIVES the same number
 * instead of re-deriving (and re-omitting) it.
 */
export function worstCaseMs(attempts: number, perAttemptTimeoutMs: number): number {
  const n = Math.max(0, Math.floor(attempts));
  let backoff = 0;
  for (let i = 1; i <= n - 1; i++) backoff += islRetryBackoffMs(i);
  return n * perAttemptTimeoutMs + backoff;
}

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
