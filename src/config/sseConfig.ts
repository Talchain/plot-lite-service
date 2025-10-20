/**
 * P1: SSE-specific configuration helpers
 * Reads from environment variables with safe defaults
 */

export function getSseHeartbeatMs(): number {
  const val = Number(process.env.SSE_HEARTBEAT_MS ?? 30000);
  return Math.max(0, Math.min(60000, val));
}

export function getSseMaxBufferedEvents(): number {
  const val = Number(process.env.SSE_MAX_BUFFERED_EVENTS ?? 100);
  return Math.max(1, Math.min(10000, val));
}

export function getSseBackpressureThreshold(): number {
  const val = Number(process.env.SSE_BACKPRESSURE_THRESHOLD ?? 10);
  return Math.max(1, val);
}
