// Rolling latency metrics and lightweight counters
import { monitorEventLoopDelay } from 'node:perf_hooks';
const MAX_SAMPLES = 500;
const samples = [];
let c2xx = 0, c4xx = 0, c5xx = 0;
let lastReplayStatus = 'unknown';
// P1: Track last request timestamp for /v1/health enrichment
let lastRequestAtISO = new Date().toISOString();
// P1: Engine compute metrics (separate from overall request latency)
const engineSamples = [];
let lastComputeMs = 0;
let rollingEngineP95Ms = 0;
// P1: 429 counters (JSON vs SSE)
let json429Count = 0;
let sse429Count = 0;
// P1: SSE guardrail counters
let sseOpen = 0;
let sseClosed = 0;
let sseTimeout = 0;
// P1: Stream backpressure / lifecycle counters (used for health extras)
let streamRateLimited = 0;
let streamDisconnect = 0;
let streamWriteBackpressure = 0;
// P1: Last config reload timestamp (SIGHUP hot-reload)
let lastConfigReloadISO;
// Event loop delay histogram (Node >=12)
const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();
// Optional cache size snapshot for SIGUSR2 and /ops/snapshot
let idemCacheSize = 0;
export function setIdemCacheSize(n) { idemCacheSize = n; }
export function getIdemCacheSize() { return idemCacheSize; }
export function recordDurationMs(ms) {
    samples.push(ms);
    if (samples.length > MAX_SAMPLES)
        samples.shift();
    // Update last_request_at for /v1/health
    try {
        lastRequestAtISO = new Date().toISOString();
    }
    catch { }
}
export function recordStatus(code) {
    if (code >= 200 && code < 300)
        c2xx++;
    else if (code >= 400 && code < 500)
        c4xx++;
    else if (code >= 500)
        c5xx++;
}
export function setLastReplay(status) {
    lastReplayStatus = status;
}
export function snapshot() {
    return { c2xx, c4xx, c5xx, lastReplayStatus };
}
export function p95Ms() {
    if (samples.length === 0)
        return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
    return Math.round(sorted[idx]);
}
export function p99Ms() {
    if (samples.length === 0)
        return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(0.99 * (sorted.length - 1)));
    return Math.round(sorted[idx]);
}
export function eventLoopDelayMs() {
    // mean is in nanoseconds
    // guard in case eld is not available
    try {
        return Math.round((eld.mean || 0) / 1e6);
    }
    catch {
        return 0;
    }
}
// --- P1: Engine compute metrics ---
export function recordEngineComputeMs(ms) {
    if (!Number.isFinite(ms) || ms < 0)
        return;
    lastComputeMs = ms;
    engineSamples.push(ms);
    if (engineSamples.length > MAX_SAMPLES)
        engineSamples.shift();
    const currentP95 = getEngineP95Ms();
    if (rollingEngineP95Ms === 0) {
        rollingEngineP95Ms = currentP95;
    }
    else {
        // EWMA with alpha=0.1 for smooth tracking
        rollingEngineP95Ms = 0.1 * currentP95 + 0.9 * rollingEngineP95Ms;
    }
}
export function getLastComputeMs() {
    return lastComputeMs;
}
export function getEngineP95Ms() {
    if (engineSamples.length === 0)
        return 0;
    const sorted = [...engineSamples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
    return Math.round(sorted[idx]);
}
export function getEngineP95MsRolling() {
    return Math.round(rollingEngineP95Ms);
}
// --- P1: Health enrichment helpers ---
export function getLastRequestAt() {
    return lastRequestAtISO;
}
export function setLastConfigReloadISO(iso) {
    lastConfigReloadISO = iso;
}
export function getLastConfigReloadISO() {
    return lastConfigReloadISO;
}
// --- P1: 429 counters ---
export function incJson429Count() {
    json429Count++;
}
export function incSse429Count() {
    sse429Count++;
}
export function getJson429Count() {
    return json429Count;
}
export function getSse429Count() {
    return sse429Count;
}
// --- P1: SSE guardrail counters ---
export function incSseOpen() {
    sseOpen++;
}
export function incSseClosed() {
    sseClosed++;
}
export function incSseTimeout() {
    sseTimeout++;
}
export function getSseOpen() {
    return sseOpen;
}
export function getSseClosed() {
    return sseClosed;
}
export function getSseTimeout() {
    return sseTimeout;
}
// --- P1: Stream metrics for health probes (/v1/health) ---
export function incStreamRateLimited() {
    streamRateLimited++;
}
export function incStreamDisconnect() {
    streamDisconnect++;
}
export function incStreamWriteBackpressure() {
    streamWriteBackpressure++;
}
export function getStreamHealthExtras() {
    // If nothing has happened yet, omit optional keys entirely
    if (streamRateLimited === 0 &&
        streamDisconnect === 0 &&
        streamWriteBackpressure === 0 &&
        sseOpen === 0 &&
        sseClosed === 0 &&
        sseTimeout === 0) {
        return {};
    }
    return {
        stream_rate_limited: streamRateLimited,
        stream_disconnects: streamDisconnect,
        stream_write_backpressure: streamWriteBackpressure,
        sse_open: sseOpen,
        sse_closed: sseClosed,
        sse_timeout: sseTimeout,
    };
}
// Test-only helper: reset stream/SSE metrics between health tests
export function resetStreamMetrics() {
    json429Count = 0;
    sse429Count = 0;
    sseOpen = 0;
    sseClosed = 0;
    sseTimeout = 0;
    streamRateLimited = 0;
    streamDisconnect = 0;
    streamWriteBackpressure = 0;
}
