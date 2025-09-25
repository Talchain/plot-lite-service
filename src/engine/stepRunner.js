import { getStepHandler } from './registry.js';
import { getLimiter } from './ratelimit.js';
import { backoffNext } from './backoff.js';
import { getBreaker } from './breaker.js';

export async function runStepCore({ ctx, step, caps, traceId }) {
  const deadlineAt = caps && typeof caps.deadlineAt === 'number' ? caps.deadlineAt : null;

  function nowMs() { return Date.now(); }
  async function withTimeout(promise, ms) {
    if (!ms || ms <= 0) return promise;
    let to;
    const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), ms); });
    try {
      const res = await Promise.race([promise, timeout]);
      clearTimeout(to);
      return res;
    } catch (e) {
      clearTimeout(to);
      throw e;
    }
  }

  const handler = getStepHandler(step.type);
  if (!handler) throw new Error(`no handler for step type: ${step.type}`);

  const retry = step.retry || {};
  const maxAttempts = Math.max(1, Number(retry.max) || 1);
  const backoffs = Array.isArray(retry.backoffMs) ? retry.backoffMs.map(n => Math.max(0, Number(n) || 0)) : [];
  const jitter = retry.jitter ? 'full' : false;

  const breakerCfg = step.breaker || {};
  const breakerKey = breakerCfg && breakerCfg.key ? String(breakerCfg.key) : String(step.id || step.type || 'step');
  const breaker = getBreaker(breakerKey, {
    failThreshold: breakerCfg.failThreshold,
    cooldownMs: breakerCfg.cooldownMs,
    halfOpenMax: breakerCfg.halfOpenMax,
  });

  let attempts = 0;
  let ok = false;
  let lastFail = null; // 'timeout' | 'rate-limit' | 'error' | 'breaker-open'

  while (attempts < maxAttempts) {
    // breaker gate
    if (!breaker.canPass(nowMs())) { lastFail = 'breaker-open'; break; }

    attempts++;

    // rate limit gate per attempt
    if (step.rateLimit && step.rateLimit.key && typeof step.rateLimit.limit === 'number' && typeof step.rateLimit.intervalMs === 'number') {
      const lim = getLimiter(step.rateLimit.key);
      lim.configure({ limit: step.rateLimit.limit, intervalMs: step.rateLimit.intervalMs });
      const allowed = lim.acquire(nowMs());
      if (!allowed) {
        lastFail = 'rate-limit';
        if (attempts < maxAttempts) {
          const base = backoffs.length ? backoffs[Math.min(attempts - 1, backoffs.length - 1)] : 0;
          const waitMs = backoffNext({ strategy: 'fixed', baseMs: base, maxMs: base, jitter, attempt: attempts, seedParts: [traceId||'fanout', step.id||step.type||'step', attempts] });
          if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        break;
      }
    }

    try {
      // compute effective timeout from run caps
      let effectiveTimeoutMs = undefined;
      if (deadlineAt != null) {
        const tl = Math.max(0, deadlineAt - nowMs());
        if (typeof step.timeoutMs === 'number' && step.timeoutMs > 0) effectiveTimeoutMs = Math.min(step.timeoutMs, tl);
        else effectiveTimeoutMs = tl;
        if (effectiveTimeoutMs <= 0) throw new Error('timeout');
      } else if (typeof step.timeoutMs === 'number' && step.timeoutMs > 0) {
        effectiveTimeoutMs = step.timeoutMs;
      }

      await withTimeout(Promise.resolve().then(() => handler({ ctx, step })), effectiveTimeoutMs);
      ok = true;
      breaker.onSuccess();
      break;
    } catch (err) {
      const isTimeout = String(err && err.message || err) === 'timeout';
      lastFail = isTimeout ? 'timeout' : 'error';
      if (attempts < maxAttempts) {
        const base = backoffs.length ? backoffs[Math.min(attempts - 1, backoffs.length - 1)] : 0;
        const waitMs = backoffNext({ strategy: 'fixed', baseMs: base, maxMs: base, jitter, attempt: attempts, seedParts: [traceId||'fanout', step.id||step.type||'step', attempts] });
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      }
    }
  }

  if (!ok) breaker.onFailure(lastFail || 'error');
  return { ok, attempts, reason: ok ? undefined : (lastFail || 'retry-exhausted') };
}
