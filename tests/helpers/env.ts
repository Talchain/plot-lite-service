/**
 * Scoped environment override helper for test isolation
 * 
 * Usage:
 *   await withEnv({ RATE_LIMIT_ENABLED: '1' }, async () => {
 *     // test code that needs rate limiting
 *   });
 * 
 * For modules that read env at import-time:
 *   await withEnv({ PRINCIPAL_HMAC_SECRET: undefined }, async () => {
 *     vi.resetModules();
 *     const mod = await import('../src/...');
 *     // assertions
 *   });
 * 
 * Automatically restores original environment after the function completes.
 */

export async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T
): Promise<T> {
  const oldEnv = { ...process.env };
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) {
        delete (process.env as Record<string, string | undefined>)[k];
      } else {
        process.env[k] = v;
      }
    }
    return await fn();
  } finally {
    process.env = oldEnv;
  }
}
