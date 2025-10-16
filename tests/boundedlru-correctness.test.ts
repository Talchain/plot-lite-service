import { describe, it, expect } from 'vitest';
import { BoundedLRU } from '../src/lib/BoundedLRU.js';

describe('BoundedLRU Correctness (F1)', () => {
  it('get non-mutating on expired', async () => {
    const cache = new BoundedLRU<string>({ maxSize: 10, ttlMs: 50 });
    cache.set('k1', 'v1');
    await new Promise(r => setTimeout(r, 100));
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.getSize()).toBe(1); // Not mutated
  });

  it('O(1) eviction performance', () => {
    const cache = new BoundedLRU<number>({ maxSize: 5000, ttlMs: 60000 });
    const start = Date.now();
    for (let i = 0; i < 10000; i++) {
      cache.set(`key${i}`, i);
    }
    const elapsed = Date.now() - start;
    expect(cache.getSize()).toBeLessThanOrEqual(5000);
    expect(elapsed).toBeLessThan(500); // Performance budget
  });

  it('stats tracking', () => {
    const cache = new BoundedLRU<string>({ maxSize: 5, ttlMs: 60000 });
    cache.set('a', '1');
    cache.get('a'); // hit
    cache.get('b'); // miss
    
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });
});
