export const FLAGS = {
  get INSPECTOR_DEBUG_ENABLE() {
    return process.env.INSPECTOR_DEBUG_ENABLE === '1' || process.env.NODE_ENV === 'test';
  },

  get COMPARE_VIEW_ENABLE() {
    return process.env.COMPARE_VIEW_ENABLE === '1' || process.env.NODE_ENV === 'test';
  },

  get SCM_LITE_ENABLE() {
    const v = process.env.SCM_LITE_ENABLE;
    if (v === '0') return false;   // hard disable (even in NODE_ENV=test)
    if (v === '1') return true;    // hard enable
    return process.env.NODE_ENV === 'test' ? true : false;
  },

  get RATE_LIMIT_MAX() {
    return Number(process.env.RATE_LIMIT_MAX ?? (process.env.NODE_ENV === 'test' ? 1000 : 60));
  },

  get RATE_LIMIT_WINDOW_MS() {
    return Number(process.env.RATE_LIMIT_WINDOW_MS ?? (process.env.NODE_ENV === 'test' ? 1000 : 60_000));
  },
} as const;
