// Simple in-memory circuit breaker
// Policy: { failThreshold, cooldownMs, halfOpenMax }
const BREAKERS = new Map();

function now() { return Date.now(); }

export function getBreaker(key, policy = {}) {
  const k = String(key || 'default');
  let b = BREAKERS.get(k);
  if (!b) {
    b = {
      state: 'closed',
      failureCount: 0,
      openedAt: 0,
      halfOpenProbes: 0,
      policy: normalize(policy),
    };
    BREAKERS.set(k, b);
  } else {
    // refresh policy if provided
    b.policy = { ...b.policy, ...normalize(policy) };
  }
  return {
    canPass(ts = now()) {
      if (b.state === 'open') {
        if ((ts - b.openedAt) >= b.policy.cooldownMs) {
          // transition to half-open
          b.state = 'half-open';
          b.halfOpenProbes = 0;
          return true;
        }
        return false;
      }
      if (b.state === 'half-open') {
        if (b.halfOpenProbes < b.policy.halfOpenMax) {
          b.halfOpenProbes++;
          return true;
        }
        return false;
      }
      return true; // closed
    },
    onSuccess() {
      // Success resets to closed
      b.state = 'closed';
      b.failureCount = 0;
      b.halfOpenProbes = 0;
      b.openedAt = 0;
    },
    onFailure(reason, ts = now()) {
      // budget-exceeded and breaker-open should not count toward failures
      if (reason === 'budget-exceeded' || reason === 'breaker-open') return;
      b.failureCount++;
      if (b.failureCount >= b.policy.failThreshold) {
        b.state = 'open';
        b.openedAt = ts;
        b.halfOpenProbes = 0;
      }
    },
    _debug() { return { ...b }; }
  };
}

function normalize(p) {
  const failThreshold = Math.max(1, Number(p.failThreshold) || 3);
  const cooldownMs = Math.max(1, Number(p.cooldownMs) || 30000);
  const halfOpenMax = Math.max(1, Number(p.halfOpenMax) || 1);
  return { failThreshold, cooldownMs, halfOpenMax };
}
