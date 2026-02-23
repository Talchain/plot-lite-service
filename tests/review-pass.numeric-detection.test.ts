/**
 * Tests for numeric claim detection.
 *
 * Verifies:
 * - Percentage patterns detected
 * - Multiplier patterns detected
 * - Allowed patterns (years, ordinals, versions) NOT detected
 * - Citation validation
 */

import { describe, it, expect } from 'vitest';
import { containsNumericClaim, validateCitations } from '../src/review-pass/numeric-detection.js';
import type { Citation } from '../src/review-pass/types.js';

describe('containsNumericClaim', () => {
  // --- Detected (requires citation) ---

  it('detects percentage pattern: "73% probability"', () => {
    expect(containsNumericClaim('73% probability')).toBe(true);
  });

  it('detects decimal percentage: "45.2% chance"', () => {
    expect(containsNumericClaim('45.2% chance')).toBe(true);
  });

  it('detects "percent" word: "73 percent"', () => {
    expect(containsNumericClaim('73 percent')).toBe(true);
  });

  it('detects "pct" abbreviation: "45 pct"', () => {
    expect(containsNumericClaim('45 pct')).toBe(true);
  });

  it('detects percentile: "p50 value"', () => {
    expect(containsNumericClaim('p50 value')).toBe(true);
  });

  it('detects probability phrase: "probability of 73"', () => {
    expect(containsNumericClaim('probability of 73')).toBe(true);
  });

  it('detects multiplier: "2x more likely"', () => {
    expect(containsNumericClaim('2x more likely')).toBe(true);
  });

  it('detects multiplier: "1.5x less likely"', () => {
    expect(containsNumericClaim('1.5x less likely')).toBe(true);
  });

  it('detects confidence phrase: "confidence of 8"', () => {
    expect(containsNumericClaim('confidence of 8')).toBe(true);
  });

  it('detects range: "45-89% range"', () => {
    expect(containsNumericClaim('45-89% range')).toBe(true);
  });

  it('detects range with decimals: "45.2-89.1% range"', () => {
    expect(containsNumericClaim('45.2-89.1% range')).toBe(true);
  });

  // --- NOT detected (allowed patterns) ---

  it('does NOT detect "top 3 drivers"', () => {
    expect(containsNumericClaim('top 3 drivers')).toBe(false);
  });

  it('does NOT detect "top 5 factors"', () => {
    expect(containsNumericClaim('top 5 factors')).toBe(false);
  });

  it('does NOT detect year: "in 2024"', () => {
    expect(containsNumericClaim('in 2024')).toBe(false);
  });

  it('does NOT detect year: "since 2025"', () => {
    expect(containsNumericClaim('since 2025')).toBe(false);
  });

  it('does NOT detect count: "3 options available"', () => {
    expect(containsNumericClaim('3 options available')).toBe(false);
  });

  it('does NOT detect count: "5 factors"', () => {
    expect(containsNumericClaim('5 factors')).toBe(false);
  });

  it('does NOT detect step: "step 1 of the process"', () => {
    expect(containsNumericClaim('step 1 of the process')).toBe(false);
  });

  it('does NOT detect version: "v2 API"', () => {
    expect(containsNumericClaim('v2 API')).toBe(false);
  });

  it('does NOT detect version: "v2.0 release"', () => {
    expect(containsNumericClaim('v2.0 release')).toBe(false);
  });

  // --- Edge cases ---

  it('detects claim mixed with allowed: "top 3 factors with 73% confidence"', () => {
    expect(containsNumericClaim('top 3 factors with 73% confidence')).toBe(true);
  });

  it('does NOT detect empty string', () => {
    expect(containsNumericClaim('')).toBe(false);
  });

  it('does NOT detect plain text', () => {
    expect(containsNumericClaim('This is just plain text')).toBe(false);
  });
});

describe('validateCitations', () => {
  it('returns violation when numeric claim has no citations', () => {
    const violations = validateCitations('73% probability', []);
    expect(violations).toEqual(['Numeric claim without citation']);
  });

  it('returns no violations when numeric claim has citations', () => {
    const citations: Citation[] = [
      { fact_id: 'fact_001', role: 'supports' },
    ];
    const violations = validateCitations('73% probability', citations);
    expect(violations).toEqual([]);
  });

  it('returns no violations when no numeric claims present', () => {
    const violations = validateCitations('This is plain text', []);
    expect(violations).toEqual([]);
  });

  it('returns no violations for allowed patterns without citations', () => {
    const violations = validateCitations('top 3 drivers in 2024', []);
    expect(violations).toEqual([]);
  });
});
