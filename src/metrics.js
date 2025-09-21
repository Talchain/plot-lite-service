// Rolling p95 of request durations
const MAX_SAMPLES = 500;
const samples = [];
let c2xx = 0, c4xx = 0, c5xx = 0;
let lastReplayStatus = 'unknown';
export function recordDurationMs(ms) {
    samples.push(ms);
    if (samples.length > MAX_SAMPLES)
        samples.shift();
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
