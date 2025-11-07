export const FLAGS = {
  get INSPECTOR_DEBUG_ENABLE() {
    return process.env.INSPECTOR_DEBUG_ENABLE === '1' || process.env.NODE_ENV === 'test';
  },
  get COMPARE_VIEW_ENABLE() {
    return process.env.COMPARE_VIEW_ENABLE === '1' || process.env.NODE_ENV === 'test';
  },
  get SCM_LITE_ENABLE() {
    return process.env.SCM_LITE_ENABLE === '1';
  },
  get RATE_LIMIT_RPM() {
    const v = Number(process.env.RATE_LIMIT_RPM);
    if (Number.isFinite(v) && v >= 0) return v;
    return process.env.NODE_ENV === 'test' ? 120 : 60;
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
