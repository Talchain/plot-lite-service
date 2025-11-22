/**
 * Safe Environment Variable Helper
 * 
 * Temporarily sets environment variables for a test block,
 * then automatically restores them to their original state.
 * 
 * Usage:
 * ```typescript
 * import { withEnv } from './utils/withEnv';
 * 
 * it('test with temp env', async () => {
 *   await withEnv({ TEST_ROUTES: '1' }, async () => {
 *     // TEST_ROUTES is '1' here
 *     // auto-restored afterwards
 *   });
 * });
 * ```
 */

type EnvKeys = Record<string, string | undefined>;

/**
 * Execute a function with temporary environment variables.
 * Automatically restores original values (including undefined) afterwards.
 */
export async function withEnv<T>(vars: EnvKeys, fn: () => Promise<T> | T): Promise<T> {
  const prev: EnvKeys = {};
  
  // Capture original values
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
  }
  
  try {
    // Set temporary values
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    
    // Execute function
    return await fn();
  } finally {
    // Restore original values
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

/**
 * Synchronous version of withEnv for non-async functions
 */
export function withEnvSync<T>(vars: EnvKeys, fn: () => T): T {
  const prev: EnvKeys = {};
  
  // Capture original values
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
  }
  
  try {
    // Set temporary values
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    
    // Execute function
    return fn();
  } finally {
    // Restore original values
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}
