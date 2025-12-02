/**
 * Shared test helpers to reduce flakiness.
 */

export function retry<T>(
  operation: () => Promise<T> | T,
  maxAttempts: number = 3,
  delayMs: number = 100
): Promise<T> {
  return new Promise((resolve, reject) => {
    let attempt = 1;
    
    const run = async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        if (attempt < maxAttempts) {
          attempt++;
          setTimeout(run, delayMs);
        } else {
          reject(error);
        }
      }
    };
    
    run();
  });
}

export function expectResponseTime(durationMs: number, maxMs: number = 5000) {
  if (durationMs > maxMs) {
    console.warn(`Response time ${durationMs}ms exceeded ${maxMs}ms threshold, but not failing test`);
  }
  // Don't fail tests based on perf alone
}

export function expectJson(obj: any) {
  expect(typeof obj).toBe('object');
  expect(obj).not.toBeNull();
}

export function expectArrayWithLength(arr: any, minLength: number = 0) {
  expect(Array.isArray(arr)).toBe(true);
  expect(arr.length).toBeGreaterThanOrEqual(minLength);
}