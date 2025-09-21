/**
 * In-memory L1 cache with LRU eviction, TTL and tag-based invalidation
 */
class MemoryCache {
    cache = new Map();
    tagIndex = new Map(); // tag -> Set of keys
    hits = 0;
    misses = 0;
    cleanupInterval;
    maxKeys;
    constructor(maxKeys = Number(process.env.CACHE_L1_MAX_KEYS || 1000)) {
        this.maxKeys = maxKeys;
        // Clean up expired entries every 30 seconds
        this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
    }
    async get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }
        if (Date.now() > entry.expiresAt) {
            this.delete(key);
            this.misses++;
            return null;
        }
        // LRU: Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);
        this.hits++;
        return entry.data;
    }
    async set(key, value, ttlMs, tags) {
        const expiresAt = Date.now() + ttlMs;
        // If updating existing key, remove from tag index first
        if (this.cache.has(key)) {
            this.delete(key);
        }
        // LRU eviction: Remove oldest entries if at capacity
        while (this.cache.size >= this.maxKeys) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.delete(oldestKey);
            }
        }
        this.cache.set(key, { data: value, tags, expiresAt });
        // Update tag index
        for (const tag of tags) {
            if (!this.tagIndex.has(tag)) {
                this.tagIndex.set(tag, new Set());
            }
            this.tagIndex.get(tag).add(key);
        }
    }
    async invalidateByTag(tag) {
        const keys = this.tagIndex.get(tag);
        if (!keys)
            return;
        for (const key of keys) {
            this.delete(key);
        }
        this.tagIndex.delete(tag);
    }
    async clear() {
        this.cache.clear();
        this.tagIndex.clear();
        this.hits = 0;
        this.misses = 0;
    }
    stats() {
        return {
            hits: this.hits,
            misses: this.misses,
            size: this.cache.size
        };
    }
    delete(key) {
        const entry = this.cache.get(key);
        if (entry) {
            // Remove from tag index
            for (const tag of entry.tags) {
                const keys = this.tagIndex.get(tag);
                if (keys) {
                    keys.delete(key);
                    if (keys.size === 0) {
                        this.tagIndex.delete(tag);
                    }
                }
            }
        }
        this.cache.delete(key);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                this.delete(key);
            }
        }
    }
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.clear();
    }
}
/**
 * Redis L2 cache using Upstash REST API
 */
class RedisCache {
    baseUrl;
    token;
    hits = 0;
    misses = 0;
    constructor(url, token) {
        this.baseUrl = url.replace(/\/$/, ''); // Remove trailing slash
        this.token = token;
    }
    async get(key) {
        try {
            const response = await fetch(`${this.baseUrl}/get/${encodeURIComponent(key)}`, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            if (!response.ok) {
                this.misses++;
                return null;
            }
            const data = await response.json();
            if (data.result === null) {
                this.misses++;
                return null;
            }
            this.hits++;
            return data.result;
        }
        catch {
            this.misses++;
            return null;
        }
    }
    async set(key, value, ttlMs, tags) {
        try {
            const ttlSeconds = Math.ceil(ttlMs / 1000);
            // Set the main key with TTL
            await fetch(`${this.baseUrl}/setex/${encodeURIComponent(key)}/${ttlSeconds}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(value)
            });
            // Set tag indexes (for invalidation)
            for (const tag of tags) {
                await fetch(`${this.baseUrl}/sadd/${encodeURIComponent(`tag:${tag}`)}`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify([key])
                });
                // Set TTL on tag set (slightly longer than data TTL)
                await fetch(`${this.baseUrl}/expire/${encodeURIComponent(`tag:${tag}`)}/${ttlSeconds + 60}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${this.token}` }
                });
            }
        }
        catch (error) {
            // Log error but don't throw - cache misses are acceptable
            console.warn('Redis cache set failed:', error);
        }
    }
    async invalidateByTag(tag) {
        try {
            // Get all keys for this tag
            const response = await fetch(`${this.baseUrl}/smembers/${encodeURIComponent(`tag:${tag}`)}`, {
                headers: { Authorization: `Bearer ${this.token}` }
            });
            if (response.ok) {
                const data = await response.json();
                const keys = data.result;
                if (keys && keys.length > 0) {
                    // Delete all keys
                    for (const key of keys) {
                        await fetch(`${this.baseUrl}/del/${encodeURIComponent(key)}`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${this.token}` }
                        });
                    }
                    // Delete the tag set
                    await fetch(`${this.baseUrl}/del/${encodeURIComponent(`tag:${tag}`)}`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${this.token}` }
                    });
                }
            }
        }
        catch (error) {
            console.warn('Redis cache invalidation failed:', error);
        }
    }
    async clear() {
        // Not implemented for Redis - would require FLUSHDB which is dangerous
        throw new Error('Clear not supported for Redis cache');
    }
    stats() {
        return {
            hits: this.hits,
            misses: this.misses,
            size: -1 // Unknown for Redis
        };
    }
}
/**
 * Combined L1 + L2 cache
 */
class TieredCache {
    l1;
    l2;
    constructor(l2) {
        this.l1 = new MemoryCache();
        this.l2 = l2 || null;
    }
    async get(key) {
        // Try L1 first
        const l1Result = await this.l1.get(key);
        if (l1Result !== null) {
            return l1Result;
        }
        // Try L2 if available
        if (this.l2) {
            const l2Result = await this.l2.get(key);
            if (l2Result !== null) {
                // Backfill L1 with shorter TTL (30 seconds)
                await this.l1.set(key, l2Result, 30000, []);
                return l2Result;
            }
        }
        return null;
    }
    async set(key, value, ttlMs, tags) {
        // Set in L1
        await this.l1.set(key, value, ttlMs, tags);
        // Set in L2 if available
        if (this.l2) {
            await this.l2.set(key, value, ttlMs, tags);
        }
    }
    async invalidateByTag(tag) {
        await this.l1.invalidateByTag(tag);
        if (this.l2) {
            await this.l2.invalidateByTag(tag);
        }
    }
    async clear() {
        await this.l1.clear();
        // Don't clear L2 Redis
    }
    stats() {
        const l1Stats = this.l1.stats();
        const l2Stats = this.l2?.stats() || { hits: 0, misses: 0, size: 0 };
        return {
            hits: l1Stats.hits + l2Stats.hits,
            misses: l1Stats.misses + l2Stats.misses,
            size: l1Stats.size
        };
    }
}
/**
 * Cache manager with singleflight support
 */
class CacheManagerImpl {
    cache;
    singleflight = new Map();
    l2Enabled;
    constructor(cache, l2Enabled) {
        this.cache = cache;
        this.l2Enabled = l2Enabled;
        // Clean up stale singleflight entries every 30 seconds
        setInterval(() => this.cleanupSingleflight(), 30000);
    }
    async get(key) {
        return this.cache.get(key);
    }
    async set(key, value, ttlMs, tags) {
        return this.cache.set(key, value, ttlMs, tags);
    }
    async getOrCompute(key, ttlMs, tags, computeFn) {
        // Check cache first
        const cached = await this.cache.get(key);
        if (cached !== null) {
            return { value: cached, fromCache: true };
        }
        // Check if computation is already in flight
        const existing = this.singleflight.get(key);
        if (existing) {
            const value = await existing.promise;
            return { value, fromCache: false };
        }
        // Start new computation
        const promise = computeFn();
        this.singleflight.set(key, { promise, timestamp: Date.now() });
        try {
            const value = await promise;
            // Store in cache
            await this.cache.set(key, value, ttlMs, tags);
            return { value, fromCache: false };
        }
        finally {
            // Clean up singleflight entry
            this.singleflight.delete(key);
        }
    }
    async invalidateByTag(tag) {
        return this.cache.invalidateByTag(tag);
    }
    async clear() {
        this.singleflight.clear();
        return this.cache.clear();
    }
    stats() {
        const cacheStats = this.cache.stats();
        return {
            ...cacheStats,
            l2Enabled: this.l2Enabled
        };
    }
    cleanupSingleflight() {
        const now = Date.now();
        const maxAge = 30000; // 30 seconds
        for (const [key, entry] of this.singleflight) {
            if (now - entry.timestamp > maxAge) {
                this.singleflight.delete(key);
            }
        }
    }
}
// Global cache instance
let cacheManager = null;
export function createCacheManager() {
    if (cacheManager) {
        return cacheManager;
    }
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const l2Enabled = !!(redisUrl && redisToken);
    let cache;
    if (l2Enabled) {
        const l2 = new RedisCache(redisUrl, redisToken);
        cache = new TieredCache(l2);
    }
    else {
        cache = new TieredCache();
    }
    cacheManager = new CacheManagerImpl(cache, l2Enabled);
    return cacheManager;
}
export function getCacheManager() {
    return cacheManager;
}
export function clearCacheManagerInstance() {
    cacheManager = null;
}
// Legacy exports for backward compatibility
export function createCache() {
    return createCacheManager();
}
export function getCache() {
    return getCacheManager();
}
export function clearCacheInstance() {
    clearCacheManagerInstance();
}
