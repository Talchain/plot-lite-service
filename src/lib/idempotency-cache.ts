/**
 * P2: Idempotency Cache for /v1/run
 * Prevents duplicate computations via Idempotency-Key header
 */

import { createHash } from 'node:crypto';
import { BoundedLRU } from './BoundedLRU.js';

export interface CachedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  computedAt: number;
  expiresAt: number;
}

export interface CacheKeyComponents {
  method: string;
  path: string;
  principal: string;
  bodyHash: string;
  idempotencyKey: string;
  version: string;
}

export class IdempotencyCache {
  private cache: BoundedLRU<CachedResponse>;
  private enabled: boolean;

  constructor(maxSize: number, ttlMs: number, enabled = false) {
    this.cache = new BoundedLRU<CachedResponse>({ maxSize, ttlMs });
    this.enabled = enabled;
  }

  /**
   * Generate deterministic cache key from components
   */
  static generateKey(components: CacheKeyComponents): string {
    const parts = [
      components.method,
      components.path,
      components.principal,
      components.bodyHash,
      components.idempotencyKey,
      components.version
    ];
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }

  /**
   * Hash request body for cache key
   */
  static hashBody(body: unknown): string {
    const normalized = JSON.stringify(body);
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Set cached response
   */
  set(key: string, value: CachedResponse): void {
    if (!this.enabled) return;
    this.cache.set(key, value);
  }

  /**
   * Get cached response (returns undefined if expired or not found)
   */
  get(key: string): CachedResponse | undefined {
    if (!this.enabled) return undefined;
    return this.cache.get(key);
  }

  /**
   * Check if key exists and is valid
   */
  has(key: string): boolean {
    if (!this.enabled) return false;
    return this.cache.has(key);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Enable/disable cache
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
