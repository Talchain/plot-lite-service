/**
 * Simple semaphore for controlling concurrent operations
 * Used by run_batch and run_bundle for CPU/memory protection
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next?.();
    } else {
      this.permits++;
    }
  }

  /**
   * Current number of available permits (for testing/observability)
   */
  available(): number {
    return this.permits;
  }

  /**
   * Number of waiters in the queue (for testing/observability)
   */
  waitingCount(): number {
    return this.waiting.length;
  }
}

/**
 * Process items with controlled concurrency using a semaphore
 * Preserves result ordering regardless of completion order
 */
export async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const semaphore = new Semaphore(concurrency);
  const results: R[] = new Array(items.length);

  await Promise.all(
    items.map(async (item, index) => {
      await semaphore.acquire();
      try {
        results[index] = await processor(item, index);
      } finally {
        semaphore.release();
      }
    })
  );

  return results;
}
