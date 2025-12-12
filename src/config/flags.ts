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
} as const;
