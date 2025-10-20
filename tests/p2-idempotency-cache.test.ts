import { describe, it, expect, beforeEach } from 'vitest';
import { IdempotencyCache, type CacheKeyComponents } from '../src/lib/idempotency-cache.js';

describe('P2: IdempotencyCache', () => {
  let cache: IdempotencyCache;

  beforeEach(() => {
    cache = new IdempotencyCache(10, 100, true); // 10 entries, 100ms TTL
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
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('caches and retrieves responses', () => {
    const response = {
      statusCode: 200,
      body: { result: 'ok' },
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    };
    cache.set('key1', response);
    expect(cache.get('key1')).toEqual(response);
  });

  it('respects TTL expiry', async () => {
    const response = {
      statusCode: 200,
      body: {},
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 50
    };
    cache.set('key1', response);
    expect(cache.get('key1')).toBeDefined();
    
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(cache.get('key1')).toBeUndefined();
  });

  it('does nothing when disabled', () => {
    const disabled = new IdempotencyCache(10, 1000, false);
    disabled.set('k', {
      statusCode: 200,
      body: {},
      headers: {},
      computedAt: Date.now(),
      expiresAt: Date.now() + 1000
    });
    expect(disabled.get('k')).toBeUndefined();
  });
});
