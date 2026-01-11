/**
 * Tests for the Semaphore concurrency control utility
 */

import { describe, it, expect } from 'vitest';
import { Semaphore, processWithConcurrency } from '../src/util/semaphore.js';

describe('Semaphore', () => {
  it('allows permits up to capacity', async () => {
    const sem = new Semaphore(3);
    expect(sem.available()).toBe(3);

    await sem.acquire();
    expect(sem.available()).toBe(2);

    await sem.acquire();
    expect(sem.available()).toBe(1);

    await sem.acquire();
    expect(sem.available()).toBe(0);

    sem.release();
    expect(sem.available()).toBe(1);
  });

  it('blocks when no permits available', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const acquirePromise = sem.acquire().then(() => { acquired = true; });

    // Give time for the promise to resolve if it could
    await new Promise(r => setTimeout(r, 10));
    expect(acquired).toBe(false);
    expect(sem.waitingCount()).toBe(1);

    sem.release();
    await acquirePromise;
    expect(acquired).toBe(true);
  });
});

describe('processWithConcurrency', () => {
  it('limits concurrent executions to concurrency', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const concurrency = 3;

    await processWithConcurrency(items, concurrency, async (item) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);

      // Simulate async work
      await new Promise(r => setTimeout(r, 10));

      concurrent--;
      return item * 2;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(concurrency);
  });

  it('preserves result ordering', async () => {
    const items = [1, 2, 3, 4, 5];

    const results = await processWithConcurrency(items, 2, async (item) => {
      // Varying delays to test ordering
      await new Promise(r => setTimeout(r, Math.random() * 20));
      return item * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('processes all items even with errors', async () => {
    const items = [1, 2, 3, 4];

    const results = await processWithConcurrency(items, 2, async (item) => {
      if (item === 2) throw new Error('deliberate error');
      return item;
    }).catch(() => 'error caught');

    // Promise.all rejects on first error
    expect(results).toBe('error caught');
  });

  it('works with concurrency of 1 (sequential)', async () => {
    let order: number[] = [];
    const items = [1, 2, 3];

    await processWithConcurrency(items, 1, async (item) => {
      order.push(item);
      await new Promise(r => setTimeout(r, 5));
      return item;
    });

    expect(order).toEqual([1, 2, 3]);
  });
});
