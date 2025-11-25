/**
 * CEE error code normalization for consistent metrics and logging
 */

/**
 * Normalized CEE error categories
 */
export type CeeCodeCategory = 'health' | 'config' | 'client' | 'sdk' | 'unknown';

/**
 * Normalize raw CEE error codes into consistent categories for metrics/logging
 *
 * @param rawCode - Raw error code from CEE service, adapter, or catch blocks
 * @returns Normalized category
 */
export function normalizeCeeCode(rawCode: string): CeeCodeCategory {
  const code = rawCode.toUpperCase();

  // Check SDK issues first (most specific - may contain both SDK and other keywords like UNAVAILABLE)
  if (code.includes('SDK') || code.includes('ADAPTER')) {
    return 'sdk';
  }

  // Config issues (missing credentials, disabled)
  if (code.includes('CONFIG') || code.includes('DISABLED')) {
    return 'config';
  }

  // Client issues (client errors, invalid responses, fixture errors)
  if (code.includes('CLIENT') || code.includes('INVALID') || code.includes('FIXTURE') || code.includes('PARSE')) {
    return 'client';
  }

  // Health issues (service availability, timeouts, fallbacks)
  if (code.includes('UNAVAILABLE') || code.includes('TIMEOUT') || code.includes('FALLBACK')) {
    return 'health';
  }

  // Default
  return 'unknown';
}

/**
 * Check if a feature flag is enabled
 *
 * @param raw - Raw environment variable value
 * @returns true if flag is '1' or 'true' (case-insensitive)
 */
export function isFlagOn(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === '1' || v === 'true';
}
