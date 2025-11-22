/**
 * In-Process Environment Guard
 * 
 * Snapshots TEST_ROUTES and FEATURE_STREAM at process start,
 * then verifies they haven't leaked after all tests complete.
 * 
 * This runs in-process (via Vitest setupFiles) to catch leaks
 * immediately rather than waiting for CI gate.
 * 
 * Also sets default PRINCIPAL_HMAC_SECRET for tests.
 */

import { afterAll } from 'vitest';

// Set default test secret (64 chars as required)
if (!process.env.PRINCIPAL_HMAC_SECRET) {
  process.env.PRINCIPAL_HMAC_SECRET = 'test-only-not-for-prod'.repeat(3).substring(0, 64);
}

const KEYS = ['TEST_ROUTES', 'FEATURE_STREAM'] as const;
type K = typeof KEYS[number];

// Snapshot env at module load time (before any tests run)
const start: Record<K, string | undefined> = {} as any;
for (const k of KEYS) {
  start[k] = process.env[k];
}

// After all tests, verify env hasn't leaked
afterAll(() => {
  const leaks: string[] = [];
  
  for (const k of KEYS) {
    const now = process.env[k];
    const was = start[k];
    
    // Check if the key changed
    const changed =
      (was === undefined && now !== undefined) ||
      (was !== undefined && now !== was);
    
    if (changed) {
      leaks.push(`${k}: was=${String(was)} now=${String(now)}`);
    }
  }
  
  if (leaks.length > 0) {
    throw new Error(`Env leak detected: ${leaks.join('; ')}`);
  }
});
