export const FLAGS = {
  get INSPECTOR_DEBUG_ENABLE() {
    return process.env.INSPECTOR_DEBUG_ENABLE === '1' || process.env.NODE_ENV === 'test';
  },
  get COMPARE_VIEW_ENABLE() {
    return process.env.COMPARE_VIEW_ENABLE === '1' || process.env.NODE_ENV === 'test';
  },
  get SCM_LITE_ENABLE() {
    // Never cache. Read each time.
    return process.env.SCM_LITE_ENABLE === '1';
  },
  get RATE_LIMIT_RPM() {
    // Test default 120 if not set; prod default 60
    const dft = process.env.NODE_ENV === 'test' ? 120 : 60;
    const raw = process.env.RATE_LIMIT_RPM;
    const n = raw == null || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : dft;
  },
  get PROD_SCM_LITE_PLACEHOLDER() {
    return process.env.PROD_SCM_LITE_PLACEHOLDER === '1';
  },
  get RATE_LIMIT_MAX() {
    return Number(process.env.RATE_LIMIT_MAX ?? (process.env.NODE_ENV === 'test' ? 1000 : 60));
  },
  get RATE_LIMIT_WINDOW_MS() {
    return Number(process.env.RATE_LIMIT_WINDOW_MS ?? (process.env.NODE_ENV === 'test' ? 1000 : 60_000));
  },
  // EdgeV2 feature flags (Phase 1)
  /** Enable dual beliefs (belief_exists + belief_strength) for edge sampling */
  get ENABLE_DUAL_BELIEFS() {
    return process.env.ENABLE_DUAL_BELIEFS === '1' || process.env.ENABLE_DUAL_BELIEFS === 'true';
  },
  /** Enable Noisy-OR functional form for binary nodes */
  get ENABLE_NOISY_OR() {
    return process.env.ENABLE_NOISY_OR === '1' || process.env.ENABLE_NOISY_OR === 'true';
  },
  /** Enable Logistic functional form for continuous→binary transitions */
  get ENABLE_LOGISTIC() {
    return process.env.ENABLE_LOGISTIC === '1' || process.env.ENABLE_LOGISTIC === 'true';
  },
  /** Enable Noisy-AND-NOT functional form for preventative causes (Brief 17) */
  get ENABLE_NOISY_AND_NOT() {
    return process.env.ENABLE_NOISY_AND_NOT === '1' || process.env.ENABLE_NOISY_AND_NOT === 'true';
  },
  /** Enable mixed cause combination for nodes with both generative and preventative parents (Brief 22) */
  get ENABLE_MIXED_COMBINATION() {
    return process.env.ENABLE_MIXED_COMBINATION === '1' || process.env.ENABLE_MIXED_COMBINATION === 'true';
  },
  // Brief 8: Sampling Engine & Caching flags
  /** Enable trace caching for simulation results */
  get ENABLE_TRACE_CACHING() {
    return process.env.ENABLE_TRACE_CACHING !== '0' && process.env.ENABLE_TRACE_CACHING !== 'false';
  },
  /** Enable stratified sampling for better parameter space coverage (Phase 2 stretch) */
  get ENABLE_STRATIFIED_SAMPLING() {
    return process.env.ENABLE_STRATIFIED_SAMPLING === '1' || process.env.ENABLE_STRATIFIED_SAMPLING === 'true';
  },
  /** Enable importance sampling for better tail risk estimation (Phase 2 stretch) */
  get ENABLE_IMPORTANCE_SAMPLING() {
    return process.env.ENABLE_IMPORTANCE_SAMPLING === '1' || process.env.ENABLE_IMPORTANCE_SAMPLING === 'true';
  },
  /** Enable per-option goal probabilities in results (Brief A) */
  get ENABLE_OPTION_PROBABILITIES() {
    return process.env.ENABLE_OPTION_PROBABILITIES === '1' || process.env.ENABLE_OPTION_PROBABILITIES === 'true';
  },
  // CEE Integration flags (M1 CEE Orchestrator)
  /** Enable CEE orchestrator integration for decision review */
  get CEE_ORCHESTRATOR_ENABLED() {
    const raw = process.env.CEE_ORCHESTRATOR_ENABLED;
    return raw === '1' || raw === 'true';
  },

  // M2 Decision Review Integration
  /** Enable M2 decision review (LLM-generated review with 9-tier validation) */
  get DECISION_REVIEW_ENABLE() {
    return process.env.DECISION_REVIEW_ENABLE === '1' || process.env.DECISION_REVIEW_ENABLE === 'true';
  },

  // Stream D: FactObject assembly
  /** Enable FactObjectV1 facts assembly in run_bundle response (default: true for staging/test) */
  get ENABLE_FACTS_ASSEMBLY() {
    const raw = process.env.ENABLE_FACTS_ASSEMBLY;
    if (raw === '0' || raw === 'false') return false;
    // Default on for test/staging, off for production unless explicitly enabled
    if (raw === '1' || raw === 'true') return true;
    return process.env.NODE_ENV === 'test' || process.env.RENDER_SERVICE_NAME?.includes('staging') === true;
  },

  // Track A: Validate-patch endpoint (default: true for staging/test)
  /** Enable validate-patch endpoint (default: true for staging/test, off for production unless explicit) */
  get ENABLE_VALIDATE_PATCH() {
    const raw = process.env.ENABLE_VALIDATE_PATCH;
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
    return process.env.NODE_ENV === 'test' || process.env.RENDER_SERVICE_NAME?.includes('staging') === true;
  },

  // Stream D: Review pass (deterministic cards from facts + validation)
  /** Enable review pass cards in run_bundle response (default: true for staging/test) */
  get ENABLE_REVIEW_PASS() {
    const raw = process.env.ENABLE_REVIEW_PASS;
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
    return process.env.NODE_ENV === 'test' || process.env.RENDER_SERVICE_NAME?.includes('staging') === true;
  },

  // ISL V2 science channel: per-factor counterfactual EVPI (factor_evpi wire field)
  /**
   * INTERNAL DIAGNOSTICS ONLY (default OFF everywhere, including test/staging).
   * When enabled, /v2/run logs a sanitised summary of the ISL V2 `factor_evpi`
   * wire field (via `mapIslFactorEvpi`). It NEVER changes the public response:
   * wiring factor_evpi into user-facing VOI/EVPI is decision P-5 (pending) and
   * MUST NOT happen behind this flag.
   */
  get ISL_FACTOR_EVPI_INTERNAL() {
    const raw = process.env.ISL_FACTOR_EVPI_INTERNAL;
    return raw === '1' || raw === 'true';
  },
} as const;
