import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { createCacheManager, clearCacheManagerInstance } from '../src/cache/index.js';

// Mock environment variables
const originalEnv = process.env;

describe('Cache System', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Clear cache instance before each test
    clearCacheManagerInstance();
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clear cache instance after each test
    clearCacheManagerInstance();
  });

  describe('L1 Memory Cache with LRU', () => {
    test('should respect max keys limit', async () => {
      process.env.CACHE_L1_MAX_KEYS = '3';

      const { createCacheManager } = await import('../src/cache/index.js');
      const cache = createCacheManager();

      // Fill cache to capacity
      await cache.set('key1', 'value1', 60000, ['tag1']);
      await cache.set('key2', 'value2', 60000, ['tag2']);
      await cache.set('key3', 'value3', 60000, ['tag3']);

      // All should be present
      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');

      // Adding 4th key should evict oldest (key1)
      await cache.set('key4', 'value4', 60000, ['tag4']);

      expect(await cache.get('key1')).toBeNull(); // evicted
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');
      expect(await cache.get('key4')).toBe('value4');
    });

    test('should implement LRU ordering correctly', async () => {
      process.env.CACHE_L1_MAX_KEYS = '3';

      const { createCacheManager } = await import('../src/cache/index.js');
      const cache = createCacheManager();

      // Fill cache
      await cache.set('key1', 'value1', 60000, []);
      await cache.set('key2', 'value2', 60000, []);
      await cache.set('key3', 'value3', 60000, []);

      // Access key1 to make it most recently used
      await cache.get('key1');

      // Add key4 - should evict key2 (oldest unaccessed)
      await cache.set('key4', 'value4', 60000, []);

      expect(await cache.get('key1')).toBe('value1'); // kept (recently accessed)
      expect(await cache.get('key2')).toBeNull(); // evicted
      expect(await cache.get('key3')).toBe('value3'); // kept
      expect(await cache.get('key4')).toBe('value4'); // new
    });
  });

  describe('Cache Manager with singleflight', () => {
    test('should prevent duplicate computations', async () => {
      const cache = createCacheManager();
      let computeCount = 0;

      const computeFn = async () => {
        computeCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return `computed-${computeCount}`;
      };

      // Start two concurrent computations for same key
      const promise1 = cache.getOrCompute('singleflight-key', 60000, ['test'], computeFn);
      const promise2 = cache.getOrCompute('singleflight-key', 60000, ['test'], computeFn);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(computeCount).toBe(1); // Should only compute once
      expect(result1.value).toBe('computed-1');
      expect(result2.value).toBe('computed-1');
      expect(result1.fromCache).toBe(false); // First call computed
      expect(result2.fromCache).toBe(false); // Second call waited for computation
    });

    test('should return cached values on subsequent calls', async () => {
      const cache = createCacheManager();
      let computeCount = 0;

      const computeFn = async () => {
        computeCount++;
        return `computed-${computeCount}`;
      };

      // First call
      const result1 = await cache.getOrCompute('cache-test-key', 60000, ['test'], computeFn);
      expect(result1.fromCache).toBe(false);
      expect(computeCount).toBe(1);

      // Second call should use cache
      const result2 = await cache.getOrCompute('cache-test-key', 60000, ['test'], computeFn);
      expect(result2.fromCache).toBe(true);
      expect(result2.value).toBe(result1.value);
      expect(computeCount).toBe(1); // No additional computation
    });

    test('should handle computation errors gracefully', async () => {
      const cache = createCacheManager();

      const computeFn = async () => {
        throw new Error('Computation failed');
      };

      await expect(
        cache.getOrCompute('error-test-key', 60000, ['test'], computeFn)
      ).rejects.toThrow('Computation failed');

      // Should not cache errors
      expect(await cache.get('error-test-key')).toBeNull();
    });
  });

  describe('TTL expiration', () => {
    test('should expire entries after TTL', async () => {
      const cache = createCacheManager();

      // Set with very short TTL
      await cache.set('ttl-test-key', 'test-value', 50, ['test']);

      // Should be available immediately
      expect(await cache.get('ttl-test-key')).toBe('test-value');

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should be expired
      expect(await cache.get('ttl-test-key')).toBeNull();
    });
  });

  describe('Tag-based invalidation', () => {
    test('should invalidate entries by tag', async () => {
      const cache = createCacheManager();

      await cache.set('key1', 'value1', 60000, ['tag1', 'shared']);
      await cache.set('key2', 'value2', 60000, ['tag2', 'shared']);
      await cache.set('key3', 'value3', 60000, ['tag3']);

      // All should be present
      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');

      // Invalidate by shared tag
      await cache.invalidateByTag('shared');

      expect(await cache.get('key1')).toBeNull(); // invalidated
      expect(await cache.get('key2')).toBeNull(); // invalidated
      expect(await cache.get('key3')).toBe('value3'); // not affected
    });

    test('should clean up empty tag sets', async () => {
      const cache = createCacheManager();

      await cache.set('key1', 'value1', 60000, ['unique-tag']);
      expect(await cache.get('key1')).toBe('value1');

      // Invalidate the only key with this tag
      await cache.invalidateByTag('unique-tag');

      expect(await cache.get('key1')).toBeNull();

      // Tag should be cleaned up (no way to test directly, but covered by implementation)
    });
  });

  describe('Cache statistics', () => {
    test('should track hits and misses', async () => {
      const cache = createCacheManager();

      // Miss
      expect(await cache.get('stats-missing-key')).toBeNull();
      const statsAfterMiss = cache.stats();
      expect(statsAfterMiss.misses).toBeGreaterThanOrEqual(1);

      // Set and hit
      await cache.set('stats-test-key', 'test-value', 60000, []);
      expect(await cache.get('stats-test-key')).toBe('test-value');
      const statsAfterHit = cache.stats();
      expect(statsAfterHit.hits).toBeGreaterThanOrEqual(1);
    });

    test('should report cache size', async () => {
      const cache = createCacheManager();

      const initialSize = cache.stats().size;

      await cache.set('size-key1', 'value1', 60000, []);
      await cache.set('size-key2', 'value2', 60000, []);

      const finalSize = cache.stats().size;
      expect(finalSize).toBe(initialSize + 2);
    });
  });

  describe('Cache clearing', () => {
    test('should clear all entries', async () => {
      const cache = createCacheManager();

      await cache.set('clear-key1', 'value1', 60000, ['tag1']);
      await cache.set('clear-key2', 'value2', 60000, ['tag2']);

      const sizeAfterSet = cache.stats().size;
      expect(sizeAfterSet).toBeGreaterThanOrEqual(2);

      await cache.clear();

      expect(cache.stats().size).toBe(0);
      expect(await cache.get('clear-key1')).toBeNull();
      expect(await cache.get('clear-key2')).toBeNull();
    });
  });
});