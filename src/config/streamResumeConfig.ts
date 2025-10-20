/**
 * P2: Stream Resume configuration helpers
 * Reads from environment variables with safe defaults and bounds
 */

export function getStreamResumeEnable(): boolean {
  return process.env.STREAM_RESUME_ENABLE === '1';
}

export function getStreamResumeTtlMs(): number {
  const val = Number(process.env.STREAM_RESUME_TTL_MS ?? 300000); // 5 minutes
  const min = 30000; // 30 seconds
  const max = 1800000; // 30 minutes
  return Math.max(min, Math.min(max, val));
}

export function getStreamResumeBufferSize(): number {
  const val = Number(process.env.STREAM_RESUME_BUFFER_SIZE ?? 500);
  return Math.max(50, Math.min(5000, val));
}
