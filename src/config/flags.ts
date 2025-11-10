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
} as const;
