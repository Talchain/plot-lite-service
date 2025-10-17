/**
 * Feature Flag Validation
 * Warns on unknown *_ENABLE flags to catch typos
 */

export const KNOWN_FEATURE_FLAGS = [
  'SCM_LITE_ENABLE',
  'IDENT_TAG_ENABLE',
  'PROVENANCE_ENABLE',
  'ADAPTIVE_K_ENABLE',
  'CONFIDENCE_CALIBRATED',
  'PROMETHEUS_METRICS',
  'PROMETHEUS_ENABLE',
  'OPS_SNAPSHOT_ENABLE',
  'TOKEN_RL_ENABLE',
  'WHATIF_DELTA_ENABLE',
  'FEATURE_STREAM',
  'AUTH_ENABLED',
  'TEST_ROUTES',
  'METRICS',
  'CORS_DEV',
  'OPENAPI_DEV',
] as const;

export function validateFeatureFlags(logger?: any): void {
  const unknownFlags: string[] = [];
  
  for (const key of Object.keys(process.env)) {
    if (key.endsWith('_ENABLE') || key.endsWith('_ENABLED')) {
      if (!KNOWN_FEATURE_FLAGS.includes(key as any)) {
        unknownFlags.push(key);
      }
    }
  }
  
  if (unknownFlags.length > 0) {
    const msg = `Unknown feature flags detected (possible typos): ${unknownFlags.join(', ')}`;
    if (logger) {
      logger.warn({ unknownFlags }, msg);
    } else {
      console.warn(msg);
    }
  }
}

export function getAllFeatureFlags(): Record<string, string> {
  const flags: Record<string, string> = {};
  
  for (const flag of KNOWN_FEATURE_FLAGS) {
    flags[flag] = process.env[flag] || '0';
  }
  
  // Special handling for boolean flags
  flags.RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== '0' ? '1' : '0';
  
  return flags;
}
