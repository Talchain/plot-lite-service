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

// --- Last request timestamp (for health enrichment) ---
let lastRequestAtISO: string | null = null;
export function noteLastRequestAt(): void { try { lastRequestAtISO = new Date().toISOString(); } catch { lastRequestAtISO = null; } }
export function getLastRequestAt(): string | null { return lastRequestAtISO; }

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

// --- Stream counters (for METRICS endpoint) ---
let stream_started = 0, stream_done = 0, stream_cancelled = 0, stream_limited = 0, stream_retryable = 0;
export function streamStarted() { stream_started++; }
export function streamDone() { stream_done++; }
export function streamCancelled() { stream_cancelled++; }
export function streamLimited() { stream_limited++; }
export function streamRetryable() { stream_retryable++; }
export function getStreamCounters() {
  return { stream_started, stream_done, stream_cancelled, stream_limited, stream_retryable };
}

// --- Live stream gauges ---
let currentStreams = 0;
let lastHeartbeatAt: number | null = null; // ms epoch
export function incCurrentStreams(): void { currentStreams++; }
export function decCurrentStreams(): void { currentStreams = Math.max(0, currentStreams - 1); }
export function getCurrentStreams(): number { return currentStreams; }
export function noteHeartbeat(): void { lastHeartbeatAt = Date.now(); }
export function getLastHeartbeatMs(): number { return lastHeartbeatAt ? Math.max(0, Date.now() - lastHeartbeatAt) : 0; }

// --- Draft-flows p95 history (last 5) ---
const DRAFT_MAX_SAMPLES = 500;
const draftSamples: number[] = [];
const draftP95History: number[] = [];
export function recordDraftDurationMs(ms: number) {
  draftSamples.push(ms);
  if (draftSamples.length > DRAFT_MAX_SAMPLES) draftSamples.shift();
  // compute p95 for draft samples
  if (draftSamples.length > 0) {
    const sorted = [...draftSamples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
    const p = Math.round(sorted[idx]);
    draftP95History.push(p);
    while (draftP95History.length > 5) draftP95History.shift();
  }
}
export function getDraftP95History(): number[] { return [...draftP95History]; }

// --- Optional health counters for /v1/health ---
let stream_rate_limited = 0;           // number of limiter rejections
let stream_disconnects = 0;            // number of client disconnect events
let stream_write_backpressure = 0;     // number of write() false occurrences

export function incStreamRateLimited(): void { stream_rate_limited++; }
export function incStreamDisconnect(): void { stream_disconnects++; }
export function incStreamWriteBackpressure(): void { stream_write_backpressure++; }

// Only include keys when any metric has been observed to preserve optionality
export function getStreamHealthExtras(): Partial<Record<'stream_rate_limited' | 'stream_disconnects' | 'stream_write_backpressure', number>> {
  const out: any = {};
  if (stream_rate_limited > 0) out.stream_rate_limited = stream_rate_limited;
  if (stream_disconnects > 0) out.stream_disconnects = stream_disconnects;
  if (stream_write_backpressure > 0) out.stream_write_backpressure = stream_write_backpressure;
  return out;
}

// Test-only reset to keep suites isolated
export function resetStreamMetrics(): void {
  if (process.env.NODE_ENV !== 'test') return;
  stream_rate_limited = 0;
  stream_disconnects = 0;
  stream_write_backpressure = 0;
}

// --- Observability polish: counters and last reload ---
let json429Count = 0;
let sse429Count = 0;
let lastConfigReloadISO: string | null = null;
export function incJson429Count(): void { json429Count++; }
export function incSse429Count(): void { sse429Count++; }
export function getJson429Count(): number { return json429Count; }
export function getSse429Count(): number { return sse429Count; }
export function setLastConfigReloadISO(iso: string): void { lastConfigReloadISO = iso; }
export function getLastConfigReloadISO(): string | null { return lastConfigReloadISO; }

// --- Engine compute metrics (for /v1/run observability) ---
const engineSamples: number[] = [];
const ENGINE_MAX_SAMPLES = 100;
let lastComputeMs = 0;
let rollingP95Ms = 0; // EWMA-based rolling p95

export function recordEngineComputeMs(ms: number): void {
  lastComputeMs = ms;
  engineSamples.push(ms);
  if (engineSamples.length > ENGINE_MAX_SAMPLES) engineSamples.shift();
  
  // Update rolling p95 with EWMA (alpha=0.1 for smooth tracking)
  const currentP95 = getEngineP95Ms();
  if (rollingP95Ms === 0) {
    rollingP95Ms = currentP95; // Initialize
  } else {
    rollingP95Ms = 0.1 * currentP95 + 0.9 * rollingP95Ms;
  }
}

export function getLastComputeMs(): number {
  return lastComputeMs;
}

export function getEngineP95Ms(): number {
  if (engineSamples.length === 0) return 0;
  const sorted = [...engineSamples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
  return Math.round(sorted[idx]);
}

export function getEngineP95MsRolling(): number {
  return Math.round(rollingP95Ms);
}

// SSE guardrails counters (C3)
let sseOpen = 0;
let sseClosed = 0;
let sseTimeout = 0;
export function incSseOpen() { sseOpen++; }
export function incSseClosed() { sseClosed++; }
export function incSseTimeout() { sseTimeout++; }
export function getSseOpen() { return sseOpen; }
export function getSseClosed() { return sseClosed; }
export function getSseTimeout() { return sseTimeout; }
