/**
 * Feature Flag Validation
 * Warns on unknown *_ENABLE flags to catch typos
 */

export const KNOWN_FEATURE_FLAGS = [
  // Core inference
  'SCM_LITE_ENABLE',
  'PROD_SCM_LITE_PLACEHOLDER',
  'ADAPTIVE_K_ENABLE',
  'CONFIDENCE_CALIBRATED',
  'IDENT_TAG_ENABLE',
  'PROVENANCE_ENABLE',
  // EdgeV2 / Brief 17-22 feature flags
  'ENABLE_DUAL_BELIEFS',
  'ENABLE_NOISY_OR',
  'ENABLE_LOGISTIC',
  'ENABLE_NOISY_AND_NOT',
  'ENABLE_MIXED_COMBINATION',
  // Brief 8: Sampling engine
  'ENABLE_TRACE_CACHING',
  'ENABLE_STRATIFIED_SAMPLING',
  'ENABLE_IMPORTANCE_SAMPLING',
  // Brief A: Per-option goal probabilities
  'ENABLE_OPTION_PROBABILITIES',
  // Rate limiting & circuit breaker
  'RATE_LIMIT_ENABLED',
  'TOKEN_RL_ENABLE',
  'RL_CB_ENABLE',
  // Observability
  'PROMETHEUS_METRICS',
  'PROMETHEUS_ENABLE',
  'OPS_SNAPSHOT_ENABLE',
  'METRICS',
  // Auth & security
  'AUTH_ENABLED',
  'TEST_ROUTES',
  // Development
  'CORS_DEV',
  'OPENAPI_DEV',
  'COMPARE_VIEW_ENABLE',
  'INSPECTOR_DEBUG_ENABLE',
  // Streaming
  'FEATURE_STREAM',
  'STREAM_PARITY_ENABLE',
  'WHATIF_DELTA_ENABLE',
  // CEE Integration
  'CEE_ORCHESTRATOR_ENABLED',
  'DECISION_REVIEW_ENABLE',
  // Stream D: FactObject assembly
  'ENABLE_FACTS_ASSEMBLY',
  // Review pass (deterministic cards)
  'ENABLE_REVIEW_PASS',
  // Track A: Validate-patch endpoint
  'ENABLE_VALIDATE_PATCH',
  // Lane PLoT-R3: decision_brief claim-safe surfaces (default ON; golden-fixture byte-identity gate)
  'BRIEF_CLAIM_SAFE_SURFACES_ENABLE',
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
