/**
 * Inflight Request Counter - Strict Accounting
 * Pure module with no side effects - must be decorated onto Fastify instance
 * 
 * No clamping. Underflow indicates a bug; throw in tests, log in prod.
 * This makes inflight a trust signal that proves correctness rather than masks errors.
 */

export type InflightSource = 'onRequest' | 'onResponse' | 'endStream' | 'error';

export interface InflightCounter {
  inc(): number;
  dec(source?: InflightSource): number;
  count(): number;
  stats(): { count: number; underflows: number };
}

/**
 * Create an inflight counter for tracking active requests
 * Strict accounting: no clamping, detects underflows
 */
export function createInflight(): InflightCounter {
  let count = 0;
  let underflows = 0;

  function inc(): number {
    count += 1;
    return count;
  }

  function dec(source: InflightSource = 'onResponse'): number {
    if (count <= 0) {
      underflows += 1;
      const msg = `INFLIGHT UNDERFLOW: dec from ${source} while count=${count}`;
      
      // In test contexts, fail fast; in prod, log loudly and leave count at 0
      if (process.env.TEST_ROUTES === '1' || process.env.NODE_ENV === 'test') {
        throw new Error(msg);
      } else {
        // Use console.error here; avoid coupling a logger in this pure util
        // (server should surface this in Evidence Pack)
        // eslint-disable-next-line no-console
        console.error(msg);
      }
      return count;
    }
    
    count -= 1;
    return count;
  }

  function current(): number {
    return count;
  }

  function stats(): { count: number; underflows: number } {
    return { count, underflows };
  }

  return { inc, dec, count: current, stats };
}
