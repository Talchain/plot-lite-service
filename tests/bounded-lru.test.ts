import { describe, it, expect } from 'vitest';
import { BoundedLRU } from '../src/lib/BoundedLRU.js';

describe('BoundedLRU', () => {
  it('evicts on max entries', () => {
    const lru = new BoundedLRU(3, 60000);
    lru.set('a', 1); lru.set('b', 2); lru.set('c', 3); lru.set('d', 4);
    expect(lru.size).toBe(3);
    expect(lru.has('a')).toBe(false);
  });

  it('evicts on TTL', async () => {
    const lru = new BoundedLRU(10, 50);
    lru.set('x', 1);
    await new Promise(r => setTimeout(r, 60));
    expect(lru.get('x')).toBeUndefined();
  });

  it('size stays bounded', () => {
    const lru = new BoundedLRU(100, 60000);
    for (let i = 0; i < 200; i++) lru.set(`k${i}`, i);
    expect(lru.size).toBeLessThanOrEqual(100);
  });
});

describe('BoundedLRU integration with rate limiter', () => {
  it('handles 10k unique principals without crash', () => {
    const lru = new BoundedLRU(10_000, 600_000);
    
    for (let i = 0; i < 10_000; i++) {
      lru.set(`principal-${i}`, { count: 1, windowMinute: 0, resetAt: 60000 });
    }
    
    expect(lru.size).toBeLessThanOrEqual(10_000);
    expect(lru.size).toBeGreaterThan(9_000); // Most should still be there
  });

  it('enforces cap under burst', () => {
    const lru = new BoundedLRU(100, 60000);
    
    for (let i = 0; i < 500; i++) {
      lru.set(`burst-${i}`, i);
    }
    
    expect(lru.size).toBe(100);
  });

  it('prune removes expired entries', () => {
    const lru = new BoundedLRU(100, 10);
    lru.set('a', 1);
    lru.set('b', 2);
    
    setTimeout(() => {
      lru.prune();
      expect(lru.size).toBe(0);
    }, 20);
  });
});
