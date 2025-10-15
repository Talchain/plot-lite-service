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

  constructor(options: BoundedLRUOptions) {
    this.maxSize = options.maxSize;
    this.ttlMs = options.ttlMs;
  }

  set(key: string, value: T): void {
    const now = Date.now();
    
    // Purge expired entries first
    this.purgeExpired(now);
    
    // If at capacity, evict LRU
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    this.cache.set(key, { value, createdAt: now });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    const now = Date.now();
    if (now - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    
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
  }

  private purgeExpired(now: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private evictLRU(): void {
    // Find oldest entry
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}
