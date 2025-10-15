interface CacheEntry<V> { value: V; accessTime: number; }

export class BoundedLRU<V = any> {
  private cache = new Map<string, CacheEntry<V>>();
  constructor(private maxEntries: number, private ttlMs: number) {}

  get(key: string): V | undefined {
    const now = Date.now();
    const entry = this.cache.get(key);
    if (!entry || now - entry.accessTime > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    entry.accessTime = now;
    return entry.value;
  }

  set(key: string, value: V): void {
    const now = Date.now();
    this.cache.set(key, { value, accessTime: now });
    if (this.cache.size > this.maxEntries) this.evictOldest();
  }

  has(key: string): boolean { return this.get(key) !== undefined; }
  get size(): number { return this.cache.size; }

  private evictOldest(): void {
    let oldest: [string, number] | null = null;
    for (const [k, v] of this.cache) {
      if (!oldest || v.accessTime < oldest[1]) oldest = [k, v.accessTime];
    }
    if (oldest) this.cache.delete(oldest[0]);
  }

  prune(): void {
    const now = Date.now();
    for (const [k, v] of this.cache) {
      if (now - v.accessTime > this.ttlMs) this.cache.delete(k);
    }
  }
}
