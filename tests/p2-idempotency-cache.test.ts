import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyCache, type CacheKeyComponents } from '../src/lib/idempotency-cache.js';

describe('P2: IdempotencyCache', () => {
  let cache: IdempotencyCache;

  beforeEach(() => {
    cache = new IdempotencyCache(10, 1000, true); // 10 entries, 1s TTL, enabled
  });

  it('generates deterministic cache keys', () => {
    const components: CacheKeyComponents = {
      method: 'POST',
      path: '/v1/run',
      principal: 'user-123',
      bodyHash: 'abc123',
      idempotencyKey: 'key-1',
      version: 'v1'
    };

    const key1 = IdempotencyCache.generateKey(components);
    const key2 = IdempotencyCache.generateKey(components);
    
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it('hashes request body deterministically', () => {
    const body = { graph: { nodes: [], edges: [] } };
    
    const hash1 = IdempotencyCache.hashBody(body);
    const hash2 = IdempotencyCache.hashBody(body);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('caches and retrieves responses', () => {
    const key = 'test-key';
    const response = {
      statusCode: 200,
      body: { result: 'success' },
      headers: { 'content-type': 'application/json' },
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    };

    cache.set(key, response);
    const retrieved = cache.get(key);
    
    expect(retrieved).toEqual(response);
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('respects TTL expiry', async () => {
    const key = 'test-key';
    const response = {
      statusCode: 200,
      body: { result: 'success' },
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 100
    };

    cache.set(key, response);
    expect(cache.get(key)).toBeDefined();
    
    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(cache.get(key)).toBeUndefined();
  });

  it('does nothing when disabled', () => {
    const disabledCache = new IdempotencyCache(10, 1000, false);
    
    disabledCache.set('key', {
      statusCode: 200,
      body: {},
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    });
    
    expect(disabledCache.get('key')).toBeUndefined();
    expect(disabledCache.has('key')).toBe(false);
  });

  it('can be enabled/disabled dynamically', () => {
    cache.setEnabled(false);
    expect(cache.isEnabled()).toBe(false);
    
    cache.set('key', {
      statusCode: 200,
      body: {},
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    });
    
    expect(cache.get('key')).toBeUndefined();
    
    cache.setEnabled(true);
    expect(cache.isEnabled()).toBe(true);
  });

  it('clears all entries', () => {
    cache.set('key1', {
      statusCode: 200,
      body: {},
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    });
    
    cache.set('key2', {
      statusCode: 200,
      body: {},
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    });
    
    cache.clear();
    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });
});
