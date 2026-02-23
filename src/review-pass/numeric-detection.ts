/**
 * Precise numeric claim detection for citation validation.
 *
 * Numeric claims in card text (what/why/impact) require citations.
 * This module detects numeric claims while allowing common non-claim patterns
 * (years, ordinals, version numbers, counts).
 */

import type { Citation } from './types.js';

/** Patterns that indicate a numeric claim requiring citation. */
const NUMERIC_CLAIM_PATTERNS: RegExp[] = [
  /\d+(\.\d+)?%/,                                // 73%, 45.2%
  /\d+(\.\d+)?\s*(percent|pct)/i,                // 73 percent
  /p\d{1,2}/i,                                   // p10, p50, p90
  /probability\s+(of\s+)?\d+/i,                  // probability of 73
  /\d+(\.\d+)?x\s+(more|less|likely)/i,          // 2x more likely
  /confidence\s+(of\s+)?\d+/i,                   // confidence of 0.8
  /\d+(\.\d+)?\s*-\s*\d+(\.\d+)?%?\s*range/i,   // 45-89% range
];

/** Patterns that are NOT numeric claims — mask them before detection.
 *  Word boundaries (\b) prevent partial matches like "2024%" being masked. */
const ALLOWED_PATTERNS: RegExp[] = [
  /\btop\s+\d+\b/i,                              // top 3, top 5
  /\b\d{4}\b/,                                   // years: 2024, 2025 (bounded)
  /\b\d+\s+(options?|factors?|nodes?|edges?)\b/i, // 3 options
  /\bstep\s+\d+\b/i,                             // step 1, step 2
  /\bv\d+(\.\d+)?\b/i,                           // v1, v2.0
];

/**
 * Check if text contains a numeric claim that requires citation.
 * Masks allowed patterns (years, ordinals, etc.) before detection.
 */
export function containsNumericClaim(text: string): boolean {
  let masked = text;
  for (const pattern of ALLOWED_PATTERNS) {
    masked = masked.replace(new RegExp(pattern, 'gi'), '');
  }
  return NUMERIC_CLAIM_PATTERNS.some((p) => p.test(masked));
}

/**
 * Validate that numeric claims in text have citations.
 * Returns violation messages for each detected issue.
 */
export function validateCitations(text: string, citations: Citation[]): string[] {
  const violations: string[] = [];

  if (containsNumericClaim(text) && citations.length === 0) {
    violations.push('Numeric claim without citation');
  }

  return violations;
}
