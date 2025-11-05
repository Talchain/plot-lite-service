export const FLAGS = {
  INSPECTOR_DEBUG_ENABLE:
    process.env.INSPECTOR_DEBUG_ENABLE === '1' || process.env.NODE_ENV === 'test',

  COMPARE_VIEW_ENABLE:
    process.env.COMPARE_VIEW_ENABLE === '1' || process.env.NODE_ENV === 'test',

  SCM_LITE_ENABLE:
    process.env.SCM_LITE_ENABLE === '1' || process.env.NODE_ENV === 'test',

  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? (process.env.NODE_ENV === 'test' ? 1000 : 60)),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? (process.env.NODE_ENV === 'test' ? 1000 : 60_000)),
} as const;
