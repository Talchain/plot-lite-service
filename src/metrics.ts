// Rolling latency metrics and lightweight counters
import { monitorEventLoopDelay } from 'node:perf_hooks';

const MAX_SAMPLES = 500;
const samples: number[] = [];
let c2xx = 0, c4xx = 0, c5xx = 0;
let lastReplayStatus: 'unknown' | 'ok' | 'drift' = 'unknown';

// Replay telemetry snapshot (in-memory only)
// Note: keep distinct from lastReplayStatus (legacy) to avoid breaking existing consumers.
// Monotonic counters: refusals, retries. lastStatus is 'ok' | 'fail' | 'unknown'.
let replayRefusals = 0;
let replayRetries = 0;
let replayLastStatus: 'ok' | 'fail' | 'unknown' = 'unknown';
let replayLastTs: string | null = null;

// Event loop delay histogram (Node >=12)
const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();

// Optional cache size snapshot for SIGUSR2 and /ops/snapshot
let idemCacheSize = 0;
export function setIdemCacheSize(n: number) { idemCacheSize = n; }
export function getIdemCacheSize(): number { return idemCacheSize; }

export function recordDurationMs(ms: number) {
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function recordStatus(code: number) {
  if (code >= 200 && code < 300) c2xx++; else if (code >= 400 && code < 500) c4xx++; else if (code >= 500) c5xx++;
}

// Legacy replay status (ok/drift) — keep for back-compat
export function setLastReplay(status: 'ok' | 'drift') {
  lastReplayStatus = status;
}

// Replay telemetry API (test/ops)
export function recordReplayRefusal(): void {
  replayRefusals++;
  replayLastTs = new Date().toISOString();
}
export function recordReplayRetry(): void {
  replayRetries++;
  replayLastTs = new Date().toISOString();
}
export function recordReplayStatus(status: 'ok' | 'fail'): void {
  replayLastStatus = status;
  replayLastTs = new Date().toISOString();
}
export function replaySnapshot(): { lastStatus: 'ok' | 'fail' | 'unknown'; refusals: number; retries: number; lastTs: string | null } {
  return { lastStatus: replayLastStatus, refusals: replayRefusals, retries: replayRetries, lastTs: replayLastTs };
}

export function snapshot() {
  return { c2xx, c4xx, c5xx, lastReplayStatus };
}

export function p95Ms(): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
  return Math.round(sorted[idx]);
}

export function p99Ms(): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.99 * (sorted.length - 1)));
  return Math.round(sorted[idx]);
}

export function eventLoopDelayMs(): number {
  // mean is in nanoseconds
  // guard in case eld is not available
  try { return Math.round((eld.mean || 0) / 1e6); } catch { return 0; }
}
