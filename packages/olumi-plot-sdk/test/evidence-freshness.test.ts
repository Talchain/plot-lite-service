import { describe, it, expect } from 'vitest';

import {
  classifyEvidenceFreshness,
  summarizeEvidenceFreshness,
  type EvidenceSample,
} from '../src/evidence.js';

describe('Evidence Freshness Helpers', () => {
  const fixedNow = new Date('2025-01-01T00:00:00Z');

  it('classifies fresh, aging, and stale evidence', () => {
    const fresh = classifyEvidenceFreshness('2024-12-20T00:00:00Z', { now: fixedNow, freshDays: 30, staleDays: 365 });
    expect(fresh.bucket).toBe('FRESH');
    expect(fresh.age_days).toBeGreaterThanOrEqual(0);

    const aging = classifyEvidenceFreshness('2024-09-01T00:00:00Z', { now: fixedNow, freshDays: 30, staleDays: 365 });
    expect(aging.bucket).toBe('AGING');

    const stale = classifyEvidenceFreshness('2020-01-01T00:00:00Z', { now: fixedNow, freshDays: 30, staleDays: 365 });
    expect(stale.bucket).toBe('STALE');
    expect(stale.age_days).toBeGreaterThanOrEqual(365);
  });

  it('returns UNKNOWN when timestamp is missing or invalid', () => {
    expect(classifyEvidenceFreshness(undefined, { now: fixedNow }).bucket).toBe('UNKNOWN');
    expect(classifyEvidenceFreshness(null, { now: fixedNow }).bucket).toBe('UNKNOWN');
    expect(classifyEvidenceFreshness('not-a-date', { now: fixedNow }).bucket).toBe('UNKNOWN');
  });

  it('summarises freshness across samples', () => {
    const samples: EvidenceSample[] = [
      { id: 'recent', observedAt: '2024-12-31T00:00:00Z' },
      { id: 'old', observedAt: '2023-01-01T00:00:00Z' },
      { id: 'missing' },
    ];

    const summary = summarizeEvidenceFreshness(samples, { now: fixedNow, freshDays: 30, staleDays: 365 });

    expect(summary.total).toBe(3);
    expect(summary.with_timestamp).toBe(2);
    expect(summary.oldest_days).toBeGreaterThanOrEqual(summary.newest_days ?? 0);
    expect(summary.buckets.FRESH + summary.buckets.AGING + summary.buckets.STALE + summary.buckets.UNKNOWN).toBe(3);
  });
});
