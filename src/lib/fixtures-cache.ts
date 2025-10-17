/**
 * Fixture cache with LRU bounds (C5)
 * Prevents OOM from loading many fixtures
 */
import { readFileSync } from 'fs';
import { BoundedLRU } from './BoundedLRU.js';

const fixtureCache = new BoundedLRU<string>({
  maxSize: 50,
  ttlMs: 30 * 60 * 1000, // 30min
});

/**
 * Load fixture with caching
 */
export function loadFixture(path: string): string {
  const cached = fixtureCache.get(path);
  if (cached) return cached;
  
  const content = readFileSync(path, 'utf8');
  fixtureCache.set(path, content);
  return content;
}

/**
 * Get cache size for health monitoring
 */
export function getFixtureCacheSize(): number {
  return fixtureCache.getSize();
}

/**
 * P0.2: Get cache stats for health monitoring
 */
export function getFixtureCacheStats() {
  return fixtureCache.getStats();
}

/**
 * Clear cache (test only)
 */
export function clearFixtureCache(): void {
  fixtureCache.clear();
}
