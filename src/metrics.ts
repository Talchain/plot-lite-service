// Rolling p95 of request durations
const MAX_SAMPLES = 500;
const samples: number[] = [];

export function recordDurationMs(ms: number) {
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function p95Ms(): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
  return Math.round(sorted[idx]);
}