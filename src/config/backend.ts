/**
 * Backend Configuration
 * 
 * Resolves the active inference backend based on environment configuration.
 * When SCM_LITE_ENABLE=0, uses deterministic fallback mode suitable for tests.
 */

export type Backend = 'scm_lite' | 'fallback';

/**
 * Get the active inference backend
 */
export function getActiveBackend(): Backend {
  const scmLiteEnabled = process.env.SCM_LITE_ENABLE === '1';
  return scmLiteEnabled ? 'scm_lite' : 'fallback';
}

/**
 * Check if running in fallback mode
 */
export function isFallbackMode(): boolean {
  return getActiveBackend() === 'fallback';
}

/**
 * Log backend selection (call once during server bootstrap)
 */
export function logBackendSelection(logger: any): void {
  const backend = getActiveBackend();
  const scmLite = backend === 'scm_lite' ? 'enabled' : 'disabled';
  
  logger.info({
    evt: 'backend_selected',
    backend,
    scm_lite: scmLite,
  }, `Inference backend: ${backend}`);
}
