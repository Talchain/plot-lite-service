// Deterministic backoff helper
// strategy: 'exponential' | 'fixed'
// jitter: 'full' | false
export function backoffNext({ strategy = 'fixed', baseMs = 0, maxMs = 60000, jitter = false, attempt = 1, seedParts = [] } = {}) {
  const a = Math.max(1, Number(attempt) || 1);
  let delay = 0;
  if (strategy === 'exponential') {
    const base = Math.max(0, Number(baseMs) || 0);
    const exp = base * Math.pow(2, a - 1);
    delay = Math.min(Math.max(0, Number(maxMs) || 0) || exp, exp);
  } else {
    delay = Math.max(0, Number(baseMs) || 0);
  }
  if (jitter === 'full') {
    const frac = seededUnit(seedFrom(seedParts)); // [0,1)
    delay = Math.floor(delay * frac);
  }
  return delay;
}

function seedFrom(parts) {
  const s = String(parts && parts.length ? parts.join('|') : '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededUnit(seed) {
  // xorshift32 → [0,1)
  let x = seed || 1;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17; x >>>= 0;
  x ^= x << 5;  x >>>= 0;
  return (x >>> 0) / 0xFFFFFFFF; // [0,1)
}
