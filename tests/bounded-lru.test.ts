import { describe, it, expect } from 'vitest';

describe('Bounded LRU + Principal Quotas (C1)', () => {
  it('enforces max size via LRU eviction', async () => {
    const { BoundedLRU } = await import('../src/lib/BoundedLRU.js');
    const cache = new BoundedLRU<string>({ maxSize: 3, ttlMs: 10000 });
    
    cache.set('a', 'val-a');
    cache.set('b', 'val-b');
    cache.set('c', 'val-c');
    expect(cache.getSize()).toBe(3);
    
    // Adding 4th should evict oldest (a)
    cache.set('d', 'val-d');
    expect(cache.getSize()).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe('val-d');
  });

  it('respects TTL', async () => {
    const { BoundedLRU } = await import('../src/lib/BoundedLRU.js');
    const cache = new BoundedLRU<string>({ maxSize: 10, ttlMs: 20 });
    
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
    
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(cache.get('key1')).toBeUndefined();
  });

  it('per-principal quotas prevent single-principal DoS', async () => {
    const { PrincipalQuotas } = await import('../src/lib/PrincipalQuotas.js');
    const quotas = new PrincipalQuotas({ maxKeysPerPrincipal: 3 });
    
    quotas.track('user1', 'key1');
    quotas.track('user1', 'key2');
    quotas.track('user1', 'key3');
    expect(quotas.getPrincipalCount()).toBe(1);
    
    // 4th key should evict oldest
    quotas.track('user1', 'key4');
    expect(quotas.getEvictions()).toBeGreaterThan(0);
  });

  it('burst with 10k unique keys stays bounded', async () => {
    const { BoundedLRU } = await import('../src/lib/BoundedLRU.js');
    const cache = new BoundedLRU<string>({ maxSize: 5000, ttlMs: 600000 });
    
    for (let i = 0; i < 10000; i++) {
      cache.set(`key-${i}`, `value-${i}`);
    }
    
    expect(cache.getSize()).toBeLessThanOrEqual(5000);
  });
});
