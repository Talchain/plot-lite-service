/**
 * P2: Idempotency configuration helpers
 * Reads from environment variables with safe defaults and bounds
 */

export function getIdempotencyEnable(): boolean {
  return process.env.IDEMPOTENCY_ENABLE === '1';
}

export function getIdempotencyTtlMs(): number {
  const val = Number(process.env.IDEMPOTENCY_TTL_MS ?? 1200000); // 20 minutes
  const oneMin = 60000;
  const twoHours = 7200000;
  return Math.max(oneMin, Math.min(twoHours, val));
}

export function getIdempotencyMaxBytes(): number {
  const val = Number(process.env.IDEMPOTENCY_MAX_BYTES ?? 131072); // 128KB
  const min = 16384; // 16KB
  const max = 1048576; // 1MB
  return Math.max(min, Math.min(max, val));
}

export function getIdempotencyMaxEntries(): number {
  const val = Number(process.env.IDEMPOTENCY_MAX_ENTRIES ?? 10000);
  return Math.max(100, Math.min(100000, val));
}
