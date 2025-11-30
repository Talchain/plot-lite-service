import type { CritiqueSeverity } from './types.js';

/**
 * Normalised semantic severity levels for UI/logging bridges.
 *
 * ERROR   – user or model must address before trusting output.
 * WARNING – non-blocking issue; recommended to review.
 * INFO    – informational or observational note.
 */
export type SemanticSeverity = 'ERROR' | 'WARNING' | 'INFO';

/**
 * Bridge critique severities (BLOCKER/IMPROVEMENT/OBSERVATION)
 * to INFO/WARNING/ERROR semantics.
 */
export function critiqueSeverityToLevel(severity: CritiqueSeverity): SemanticSeverity {
  switch (severity) {
    case 'BLOCKER':
      return 'ERROR';
    case 'IMPROVEMENT':
      return 'WARNING';
    case 'OBSERVATION':
    default:
      return 'INFO';
  }
}

/**
 * Bridge validation severities (error|warning) to INFO/WARNING/ERROR.
 *
 * - Missing/unknown severities default to ERROR for safety.
 */
export function validationSeverityToLevel(severity: 'error' | 'warning' | undefined | null): SemanticSeverity {
  if (severity === 'warning') return 'WARNING';
  return 'ERROR';
}
