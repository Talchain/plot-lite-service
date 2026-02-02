/**
 * Decision Review Cache Tests
 *
 * Tests for the in-memory review cache with TTL and LRU eviction.
 *
 * @see Brief: M2 Decision Review Integration, Task 7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeCacheKey,
  getCachedReview,
  setCachedReview,
  clearReviewCache,
  getReviewCacheStats,
} from '../../../src/cee/validation/review-cache.js';
import { VALID_READY_REVIEW } from './fixtures.js';

// =============================================================================
// Tests
// =============================================================================

describe('Review Cache', () => {
  beforeEach(() => {
    clearReviewCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('computeCacheKey()', () => {
    it('generates deterministic key from responseHash + briefHash', () => {
      const key1 = computeCacheKey('response123', 'brief456');
      const key2 = computeCacheKey('response123', 'brief456');

      expect(key1).toBe(key2);
    });

    it('generates different keys for different inputs', () => {
      const key1 = computeCacheKey('response123', 'brief456');
      const key2 = computeCacheKey('response789', 'brief456');
      const key3 = computeCacheKey('response123', 'brief789');

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    it('returns first 32 chars of SHA-256 hash', () => {
      const key = computeCacheKey('response', 'brief');

      expect(key.length).toBe(32);
      expect(/^[a-f0-9]+$/.test(key)).toBe(true);
    });
  });

  describe('setCachedReview() and getCachedReview()', () => {
    it('stores and retrieves review', () => {
      const key = 'test-key-123';
      const meta = { model: 'test-model', latency_ms: 500, tokens: 1000 };

      setCachedReview(key, VALID_READY_REVIEW, meta);
      const cached = getCachedReview(key);

      expect(cached).not.toBeNull();
      expect(cached!.review).toEqual(VALID_READY_REVIEW);
      expect(cached!.meta.model).toBe('test-model');
    });

    it('returns null for non-existent key', () => {
      const cached = getCachedReview('non-existent-key');

      expect(cached).toBeNull();
    });

    it('returns null for expired entry (1hr TTL)', () => {
      const key = 'test-key-ttl';
      const meta = { model: 'test-model', latency_ms: 500, tokens: 1000 };

      setCachedReview(key, VALID_READY_REVIEW, meta);

      // Advance time by 61 minutes
      vi.advanceTimersByTime(61 * 60 * 1000);

      const cached = getCachedReview(key);
      expect(cached).toBeNull();
    });

    it('returns valid entry within TTL', () => {
      const key = 'test-key-valid';
      const meta = { model: 'test-model', latency_ms: 500, tokens: 1000 };

      setCachedReview(key, VALID_READY_REVIEW, meta);

      // Advance time by 30 minutes (within 1hr TTL)
      vi.advanceTimersByTime(30 * 60 * 1000);

      const cached = getCachedReview(key);
      expect(cached).not.toBeNull();
    });

    it('updates existing entry', () => {
      const key = 'test-key-update';
      const meta1 = { model: 'model-1', latency_ms: 500, tokens: 1000 };
      const meta2 = { model: 'model-2', latency_ms: 600, tokens: 1500 };

      setCachedReview(key, VALID_READY_REVIEW, meta1);
      setCachedReview(key, VALID_READY_REVIEW, meta2);

      const cached = getCachedReview(key);
      expect(cached!.meta.model).toBe('model-2');
    });
  });

  describe('clearReviewCache()', () => {
    it('removes all entries', () => {
      const meta = { model: 'test', latency_ms: 100, tokens: 500 };

      setCachedReview('key1', VALID_READY_REVIEW, meta);
      setCachedReview('key2', VALID_READY_REVIEW, meta);
      setCachedReview('key3', VALID_READY_REVIEW, meta);

      clearReviewCache();

      expect(getCachedReview('key1')).toBeNull();
      expect(getCachedReview('key2')).toBeNull();
      expect(getCachedReview('key3')).toBeNull();
    });
  });

  describe('getReviewCacheStats()', () => {
    it('returns correct size', () => {
      const meta = { model: 'test', latency_ms: 100, tokens: 500 };

      setCachedReview('key1', VALID_READY_REVIEW, meta);
      setCachedReview('key2', VALID_READY_REVIEW, meta);

      const stats = getReviewCacheStats();
      expect(stats.size).toBe(2);
    });

    it('returns max size', () => {
      const stats = getReviewCacheStats();
      expect(stats.maxSize).toBe(1000);
    });

    it('returns TTL in milliseconds', () => {
      const stats = getReviewCacheStats();
      expect(stats.ttlMs).toBe(60 * 60 * 1000); // 1 hour
    });
  });

  describe('LRU Eviction', () => {
    it('evicts oldest entries when max size exceeded', () => {
      const meta = { model: 'test', latency_ms: 100, tokens: 500 };

      // Fill cache to max (1000 entries)
      for (let i = 0; i < 1000; i++) {
        setCachedReview(`key-${i}`, VALID_READY_REVIEW, meta);
      }

      // Add one more
      setCachedReview('key-overflow', VALID_READY_REVIEW, meta);

      // First entry should be evicted
      expect(getCachedReview('key-0')).toBeNull();

      // New entry should exist
      expect(getCachedReview('key-overflow')).not.toBeNull();

      // Size should still be max
      const stats = getReviewCacheStats();
      expect(stats.size).toBeLessThanOrEqual(1000);
    });
  });

  describe('Cache Key Stability', () => {
    it('produces same key for same response and brief', () => {
      const responseHash = 'abc123def456789012345678';
      const briefHash = 'xyz789';

      const key1 = computeCacheKey(responseHash, briefHash);
      const key2 = computeCacheKey(responseHash, briefHash);

      expect(key1).toBe(key2);
    });

    it('different response hashes produce different keys', () => {
      const briefHash = 'xyz789';

      const key1 = computeCacheKey('response-a', briefHash);
      const key2 = computeCacheKey('response-b', briefHash);

      expect(key1).not.toBe(key2);
    });

    it('different brief hashes produce different keys', () => {
      const responseHash = 'abc123';

      const key1 = computeCacheKey(responseHash, 'brief-a');
      const key2 = computeCacheKey(responseHash, 'brief-b');

      expect(key1).not.toBe(key2);
    });
  });
});
