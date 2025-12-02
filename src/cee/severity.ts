/**
 * CEE Severity Classification System
 *
 * Provides explicit severity levels and code mappings for CEE decision review
 * outputs. Used to classify issues into blocking errors, warnings worth reviewing,
 * and helpful suggestions.
 */

/**
 * CEE severity classification for decision review codes.
 */
export type CeeSeverity = 'error' | 'warning' | 'info';

/**
 * Codes that indicate blocking errors requiring immediate attention.
 * These represent fundamental issues that prevent reliable decision analysis.
 */
export const ERROR_CODES = new Set<string>([
  'LIMIT_EXCEEDED',          // Graph exceeds size/complexity limits
  'CIRCULAR_DEPENDENCY',     // Circular reasoning detected
  'MISSING_REQUIRED_NODE',   // Essential nodes missing (e.g., outcome)
  'INVALID_WEIGHT_RANGE',    // Edge weights outside valid range
  'INVALID_BELIEF_RANGE',    // Node beliefs outside valid range
]);

/**
 * Codes that indicate potential issues worth reviewing.
 * These suggest areas for improvement but do not block analysis.
 */
export const WARNING_CODES = new Set<string>([
  'MISSING_EVIDENCE',        // Key claims lack supporting evidence
  'LOW_CONFIDENCE',          // Model confidence below threshold
  'POTENTIAL_COLLIDER',      // Graph structure may cause bias
  'OUTCOME_ORPHAN',          // Outcome node has no incoming edges
  'HIGH_EDGE_DENSITY',       // Too many edges for graph size
  'STALE_EVIDENCE',          // Evidence older than freshness threshold
]);

/**
 * Codes that provide helpful suggestions and context.
 * These are educational nudges to improve decision quality.
 */
export const INFO_CODES = new Set<string>([
  'CONSIDER_CONFOUNDER',     // Missing potential confounding variable
  'ASYMMETRIC_OPTIONS',      // Options have different graph structures
  'MISSING_RISK_NODE',       // No explicit risk/downside nodes
  'COULD_ADD_FACTOR',        // Additional factors worth considering
]);

/**
 * All known CEE codes for validation.
 */
export const ALL_CEE_CODES = new Set<string>([
  ...ERROR_CODES,
  ...WARNING_CODES,
  ...INFO_CODES,
]);

/**
 * Classify a CEE code into severity level.
 *
 * @param code - CEE issue code to classify (case-sensitive).
 * @returns Severity level ('error', 'warning', or 'info').
 *
 * @example
 * classifyCeeSeverity('CIRCULAR_DEPENDENCY'); // Returns: 'error'
 */
export function classifyCeeSeverity(code: string): CeeSeverity {
  if (ERROR_CODES.has(code)) return 'error';
  if (WARNING_CODES.has(code)) return 'warning';
  if (INFO_CODES.has(code)) return 'info';

  // Unknown codes default to warning for safety.
  // This ensures new CEE codes do not silently fail.
  return 'warning';
}

/**
 * Check if a code represents a blocking error.
 *
 * @param code - CEE issue code to check.
 * @returns true if code is a blocking error, false otherwise.
 *
 * @example
 * isBlockingError('CIRCULAR_DEPENDENCY'); // Returns: true
 */
export function isBlockingError(code: string): boolean {
  return ERROR_CODES.has(code);
}

/**
 * Get a human-readable description of a severity level.
 *
 * @param severity - Severity level.
 * @returns Description suitable for UI display.
 */
export function describeSeverity(severity: CeeSeverity): string {
  switch (severity) {
    case 'error':
      return 'Blocking issue requiring immediate attention';
    case 'warning':
      return 'Potential issue worth reviewing';
    case 'info':
      return 'Suggestion to improve decision quality';
  }
}

/**
 * Validate that CEE code sets have no overlap.
 *
 * Used in tests to ensure classification consistency.
 */
export function validateCodeSets(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for overlaps between ERROR and WARNING / INFO.
  ERROR_CODES.forEach(code => {
    if (WARNING_CODES.has(code)) {
      errors.push(`Code "${code}" appears in both ERROR_CODES and WARNING_CODES`);
    }
    if (INFO_CODES.has(code)) {
      errors.push(`Code "${code}" appears in both ERROR_CODES and INFO_CODES`);
    }
  });

  // Check for overlaps between WARNING and INFO.
  WARNING_CODES.forEach(code => {
    if (INFO_CODES.has(code)) {
      errors.push(`Code "${code}" appears in both WARNING_CODES and INFO_CODES`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
