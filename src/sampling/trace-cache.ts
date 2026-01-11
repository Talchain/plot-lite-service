/**
 * Trace Caching Layer
 *
 * Brief 8: Task 3 - Trace Caching Layer
 *
 * Cache key: (graph_hash, seed, sampling_config_version)
 * Cache storage: In-memory LRU + optional Redis for persistence
 * Cache invalidation: When sampling_config_version changes, old caches invalid
 *
 * Configuration:
 * - TRACE_CACHE_ENABLED=true
 * - TRACE_CACHE_MAX_SIZE=1000  // Number of trace sets
 * - TRACE_CACHE_TTL=3600  // Seconds
 */

import type { SimulationTraces, TraceCacheStats } from './types.js';
import { BoundedLRU } from '../lib/BoundedLRU.js';
import { SAMPLING_CONFIG_VERSION } from './types.js';
import { buildCacheKey, parseCacheKey } from './graph-hash.js';

/**
 * Configuration for trace cache
 */
export interface TraceCacheConfig {
  /** Maximum number of trace sets to cache */
  maxSize: number;
  /** TTL in milliseconds */
  ttlMs: number;
  /** Whether cache is enabled */
  enabled: boolean;
}

/**
 * Default cache configuration
 */
const DEFAULT_CONFIG: TraceCacheConfig = {
  maxSize: 1000,
  ttlMs: 3600 * 1000, // 1 hour
  enabled: true,
};

/**
 * Get configuration from environment
 */
function getConfigFromEnv(): TraceCacheConfig {
  return {
    enabled: process.env.TRACE_CACHE_ENABLED !== '0' && process.env.TRACE_CACHE_ENABLED !== 'false',
    maxSize: parseInt(process.env.TRACE_CACHE_MAX_SIZE || '1000', 10),
    ttlMs: parseInt(process.env.TRACE_CACHE_TTL || '3600', 10) * 1000,
  };
}

/**
 * Cached trace entry with metadata
 */
interface CachedTrace {
  /** The simulation traces */
  traces: SimulationTraces;
  /** When the entry was cached */
  cachedAt: Date;
  /** Size estimate in bytes */
  sizeBytes: number;
}

/**
 * Estimate memory size of simulation traces
 */
function estimateTraceSize(traces: SimulationTraces): number {
  // Rough estimate: JSON stringify and measure
  // This is approximate but gives useful ordering for eviction
  const json = JSON.stringify(traces);
  return json.length * 2; // UTF-16 encoding
}

/**
 * Trace Cache implementation
 *
 * Provides LRU caching with TTL for simulation traces.
 * Cache keys include sampling_config_version to ensure
 * automatic invalidation when the algorithm changes.
 */
class TraceCacheImpl {
  private cache: BoundedLRU<CachedTrace>;
  private config: TraceCacheConfig;
  private hitCount = 0;
  private missCount = 0;

  constructor(config?: Partial<TraceCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...getConfigFromEnv(), ...config };
    this.cache = new BoundedLRU<CachedTrace>({
      maxSize: this.config.maxSize,
      ttlMs: this.config.ttlMs,
    });
  }

  /**
   * Get traces from cache
   *
   * @param graphHash - Hash of the graph
   * @param seed - Random seed
   * @returns Cached traces or null if not found
   */
  get(graphHash: string, seed: number): SimulationTraces | null {
    if (!this.config.enabled) {
      this.missCount++;
      return null;
    }

    const key = buildCacheKey(graphHash, seed, SAMPLING_CONFIG_VERSION);
    const entry = this.cache.get(key);

    if (entry) {
      this.hitCount++;
      return entry.traces;
    }

    this.missCount++;
    return null;
  }

  /**
   * Store traces in cache
   *
   * @param graphHash - Hash of the graph
   * @param seed - Random seed
   * @param traces - Simulation traces to cache
   */
  set(graphHash: string, seed: number, traces: SimulationTraces): void {
    if (!this.config.enabled) return;

    const key = buildCacheKey(graphHash, seed, SAMPLING_CONFIG_VERSION);
    const entry: CachedTrace = {
      traces,
      cachedAt: new Date(),
      sizeBytes: estimateTraceSize(traces),
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if traces are cached (without accessing)
   *
   * @param graphHash - Hash of the graph
   * @param seed - Random seed
   * @returns True if cached
   */
  has(graphHash: string, seed: number): boolean {
    if (!this.config.enabled) return false;

    const key = buildCacheKey(graphHash, seed, SAMPLING_CONFIG_VERSION);
    return this.cache.has(key);
  }

  /**
   * Delete traces from cache
   *
   * @param graphHash - Hash of the graph
   * @param seed - Random seed
   * @returns True if entry was deleted
   */
  delete(graphHash: string, seed: number): boolean {
    const key = buildCacheKey(graphHash, seed, SAMPLING_CONFIG_VERSION);
    return this.cache.delete(key);
  }

  /**
   * Clear all cached traces
   */
  clear(): void {
    // Create a new cache instance (simplest way to clear)
    this.cache = new BoundedLRU<CachedTrace>({
      maxSize: this.config.maxSize,
      ttlMs: this.config.ttlMs,
    });
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): TraceCacheStats {
    const lruStats = this.cache.getStats();
    const totalRequests = this.hitCount + this.missCount;

    return {
      hits: this.hitCount,
      misses: this.missCount,
      evictions: lruStats.evictions,
      hit_rate: totalRequests > 0 ? this.hitCount / totalRequests : 0,
      size: lruStats.size,
      max_size: this.config.maxSize,
    };
  }

  /**
   * Enable or disable cache
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.getStats().size;
  }

  /**
   * Get estimated memory usage in bytes
   */
  estimatedMemoryBytes(): number {
    let total = 0;
    for (const [, entry] of this.cache.entries()) {
      total += entry.sizeBytes;
    }
    return total;
  }

  /**
   * Invalidate entries for a specific graph
   * Used when a graph is known to have changed
   *
   * @param graphHash - Hash of the graph to invalidate
   * @returns Number of entries invalidated
   */
  invalidateGraph(graphHash: string): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key] of this.cache.entries()) {
      const parsed = parseCacheKey(key);
      if (parsed && parsed.graphHash === graphHash) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      count++;
    }

    return count;
  }

  /**
   * Invalidate all entries with old sampling config versions
   * Called when SAMPLING_CONFIG_VERSION is bumped
   *
   * @returns Number of entries invalidated
   */
  invalidateOldVersions(): number {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const [key] of this.cache.entries()) {
      const parsed = parseCacheKey(key);
      if (parsed && parsed.configVersion !== SAMPLING_CONFIG_VERSION) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      count++;
    }

    return count;
  }
}

/**
 * Singleton trace cache instance
 */
let traceCacheInstance: TraceCacheImpl | null = null;

/**
 * Get the trace cache singleton
 */
export function getTraceCache(): TraceCacheImpl {
  if (!traceCacheInstance) {
    traceCacheInstance = new TraceCacheImpl();
  }
  return traceCacheInstance;
}

/**
 * Reset the trace cache (for testing)
 */
export function resetTraceCache(): void {
  traceCacheInstance = null;
}

/**
 * Configure trace cache with custom options
 */
export function configureTraceCache(config: Partial<TraceCacheConfig>): void {
  traceCacheInstance = new TraceCacheImpl(config);
}

// Export the class for direct instantiation if needed
export { TraceCacheImpl };
