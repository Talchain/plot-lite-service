/**
 * Bounded LRU Cache with TTL
 * Prevents unbounded memory growth from idempotency/rate-limit caches
 */

export interface BoundedLRUOptions {
  maxSize: number;
  ttlMs: number;
}

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

export class BoundedLRU<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private sets = 0;

  constructor(options: BoundedLRUOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
  }

  set(key: string, value: T): void {
    const now = Date.now();
    
    // Throttled purge: only every 64 sets, and sample at most 128 entries
    if ((++this.sets & 63) === 0) {
      this.purgeExpiredSampled(now);
    }
    
    // If at capacity, evict LRU
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    this.cache.set(key, { value, createdAt: now });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    
    const now = Date.now();
    if (now - entry.createdAt > this.ttlMs) {
      // Expired: return undefined without mutating (defer to purge)
      this.misses++;
      return undefined;
    }
    
    this.hits++;
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  getSize(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.cache.size,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }

  /**
   * Iterate over all non-expired values in the cache.
   * This is a public API to avoid unsafe type casts accessing internal cache.
   */
  *values(): Generator<T> {
    const now = Date.now();
    for (const entry of this.cache.values()) {
      if (now - entry.createdAt <= this.ttlMs) {
        yield entry.value;
      }
    }
  }

  /**
   * Iterate over all non-expired entries in the cache.
   * This is a public API to avoid unsafe type casts accessing internal cache.
   */
  *entries(): Generator<[string, T]> {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt <= this.ttlMs) {
        yield [key, entry.value];
      }
    }
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private purgeExpiredSampled(now: number): void {
    // Bounded purge: check at most 128 oldest entries
    let checked = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (++checked > 128) break;
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private evictLRU(): void {
    // O(1): Map maintains insertion order, first key is oldest
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }
}
