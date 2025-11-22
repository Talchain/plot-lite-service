// Simple in-process fixed-window rate limiter
// Usage: const lim = getLimiter(key); lim.configure({ limit, intervalMs }); lim.acquire(nowMs)

const LIMITERS = new Map();

class FixedWindowLimiter {
  constructor() {
    this.limit = 0;
    this.intervalMs = 0;
    this.windowStartMs = 0;
    this.count = 0;
  }
  configure({ limit, intervalMs }) {
    if (typeof limit === 'number' && limit >= 0) this.limit = limit;
    if (typeof intervalMs === 'number' && intervalMs >= 0) this.intervalMs = intervalMs;
  }
  acquire(nowMs) {
    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    if (this.windowStartMs === 0) this.windowStartMs = now;
    if (this.intervalMs > 0 && (now - this.windowStartMs) >= this.intervalMs) {
      this.windowStartMs = now;
      this.count = 0;
    }
    if (this.limit === 0) return false; // deny if misconfigured
    if (this.count < this.limit) {
      this.count++;
      return true;
    }
    return false;
  }
}

export function getLimiter(key) {
  let lim = LIMITERS.get(key);
  if (!lim) { lim = new FixedWindowLimiter(); LIMITERS.set(key, lim); }
  return lim;
}