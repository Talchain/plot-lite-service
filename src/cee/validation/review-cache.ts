/**
 * Decision Review Cache
 *
 * In-memory cache for validated M1 reviews.
 * Key: SHA256(version + response_hash + brief_hash) first 32 chars
 * TTL: 1 hour
 *
 * Rules:
 * - Only cache validated responses (review_status === 'complete')
 * - On cache hit: skip CEE call, return cached m1_review
 * - Per-process cache (acceptable for PoC single-instance)
 * - Bump REVIEW_CACHE_VERSION when M1Review schema changes
 *
 * @see Brief: M2 Decision Review Integration, Task 7
 */

import { createHash } from 'node:crypto';
import type { M1Review } from './m1-review-types.js';

// =============================================================================
// Types
// =============================================================================

interface CacheEntry {
  review: M1Review;
  meta?: {
    model?: string;
    latency_ms?: number;
    tokens?: number;
  };
  cachedAt: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL in milliseconds (1 hour) */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Maximum cache size (prevents unbounded growth) */
const MAX_CACHE_SIZE = 1000;

/** Cache version - bump when M1Review schema changes to auto-invalidate stale entries */
const REVIEW_CACHE_VERSION = '1';

// =============================================================================
// Cache Storage
// =============================================================================

const cache = new Map<string, CacheEntry>();

// =============================================================================
// Public API
// =============================================================================

/**
 * Compute cache key from response_hash and brief_hash.
 * Key: SHA256(version + response_hash + brief_hash) first 32 chars
 */
export function computeCacheKey(responseHash: string, briefHash: string): string {
  const combined = `${REVIEW_CACHE_VERSION}:${responseHash}:${briefHash}`;
  return createHash('sha256').update(combined).digest('hex').slice(0, 32);
}

/**
 * Get cached review if available and not expired.
 *
 * @param cacheKey Cache key from computeCacheKey
 * @returns Cached entry or null if miss/expired
 */
export function getCachedReview(cacheKey: string): CacheEntry | null {
  const entry = cache.get(cacheKey);

  if (!entry) {
    return null;
  }

  // Check TTL
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    // Expired - remove and return null
    cache.delete(cacheKey);
    return null;
  }

  return entry;
}

/**
 * Cache a validated review.
 *
 * @param cacheKey Cache key from computeCacheKey
 * @param review Validated M1Review
 * @param meta Optional metadata from CEE response
 */
export function setCachedReview(
  cacheKey: string,
  review: M1Review,
  meta?: {
    model?: string;
    latency_ms?: number;
    tokens?: number;
  }
): void {
  // Evict oldest entries if cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    evictOldest();
  }

  cache.set(cacheKey, {
    review,
    meta,
    cachedAt: Date.now(),
  });
}

/**
 * Clear all cached reviews.
 * Useful for testing.
 */
export function clearReviewCache(): void {
  cache.clear();
}

/**
 * Get cache stats for observability.
 */
export function getReviewCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
} {
  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL_MS,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Evict oldest entries to make room.
 * Removes 10% of cache or at least 1 entry.
 */
function evictOldest(): void {
  const entriesToEvict = Math.max(1, Math.floor(MAX_CACHE_SIZE * 0.1));

  // Sort by cachedAt ascending (oldest first)
  const sortedKeys = [...cache.entries()]
    .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
    .slice(0, entriesToEvict)
    .map(([key]) => key);

  for (const key of sortedKeys) {
    cache.delete(key);
  }
}
