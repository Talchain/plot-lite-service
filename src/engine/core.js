import { createMetrics } from './metrics.js';
import { getStepHandler } from './registry.js';
import { nowMs } from './util.js';
import { getLimiter } from './ratelimit.js';
import { backoffNext } from './backoff.js';
import { getBreaker } from './breaker.js';
// ensure built-in steps are registered
import './steps/transform.js';
import './steps/gate.js';
import './steps/calc.js';
import './steps/map.js';
import './steps/fanout.js';

function asArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

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

function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function jittered(ms, key, enable) {
  const base = Math.max(0, ms | 0);
  if (!enable || base === 0) return base;
  const h = hash32(String(key));
  const frac = (h % 1000) / 1000; // [0,1)
  const factor = 0.9 + (0.2 * frac); // [0.9,1.1)
  return Math.round(base * factor);
}

export async function runPlot(plot, { input = {}, onEvent, traceId, maxDurationMs = 30000, budget } = {}) {
  const start = nowMs();
  const deadlineAt = typeof maxDurationMs === 'number' && maxDurationMs > 0 ? (start + maxDurationMs) : null;
  const ctx = { ...input };
  // Expose run caps for sub-steps (non-enumerable)
  try { Object.defineProperty(ctx, '__runCaps', { value: { deadlineAt, budget }, enumerable: false, configurable: true }); } catch {}
  const stepMap = new Map();
  for (const s of (plot.steps || [])) stepMap.set(s.id, s);
  let current = (plot.steps && plot.steps[0]) || null;

  const metrics = createMetrics();
  const record = {
    plotId: plot.id || 'unknown',
    traceId: traceId || `${start}-${Math.random().toString(36).slice(2)}`,
    startedAt: new Date(start).toISOString(),
    finishedAt: null,
    steps: [],
    final: { ctx: null },
  };
  const stats = { totalMs: 0, steps: 0, ok: 0, failed: 0, retries: 0, cost: 0 };

  const emit = (type, data = {}) => { if (typeof onEvent === 'function') try { onEvent({ type, ...data }); } catch {} };

  while (current) {
    const step = current;
    const handler = getStepHandler(step.type);
    const token = metrics.startStep(step.id);
    const stepStart = nowMs();
    emit('step-start', { id: step.id, type: step.type });

    // Run-level deadline pre-check
    if (deadlineAt != null) {
      const timeLeft0 = Math.max(0, deadlineAt - nowMs());
      if (timeLeft0 <= 0) {
        const durationMs = metrics.endStep(token);
        metrics.steps++;
        metrics.failed++;
        stats.steps++;
        stats.failed++;
        record.steps.push({ id: step.id, type: step.type, status: 'fail', durationMs, attempts: 0, reason: 'timeout' });
        emit('step-fail', { id: step.id, type: step.type, error: 'timeout' });
        break;
      }
    }

    // Budget pre-check
    const estimate = step && step.cost && typeof step.cost.estimate === 'number' ? step.cost.estimate : 0;
    if (budget && typeof budget.maxCost === 'number' && (stats.cost + estimate) > budget.maxCost) {
      const durationMs = 0;
      metrics.steps++;
      metrics.failed++;
      stats.steps++;
      stats.failed++;
      record.steps.push({ id: step.id, type: step.type, status: 'fail', durationMs, attempts: 0, reason: 'budget-exceeded' });
      emit('step-fail', { id: step.id, type: step.type, error: 'budget-exceeded' });
      break;
    }

    try {
      if (!handler) throw new Error(`no handler for step type: ${step.type}`);
      let effectiveTimeoutMs = maxDurationMs;
      if (deadlineAt != null) {
        const tl = Math.max(0, deadlineAt - nowMs());
        if (typeof step.timeoutMs === 'number' && step.timeoutMs > 0) effectiveTimeoutMs = Math.min(step.timeoutMs, tl);
        else effectiveTimeoutMs = tl;
        if (effectiveTimeoutMs <= 0) throw new Error('timeout');
      } else if (typeof step.timeoutMs === 'number' && step.timeoutMs > 0) {
        effectiveTimeoutMs = step.timeoutMs;
      }

      const retry = step.retry || {};
      const maxAttempts = Math.max(1, Number(retry.max) || 1);
      const backoffs = Array.isArray(retry.backoffMs) ? retry.backoffMs.map(n => Math.max(0, Number(n) || 0)) : [];
      const useJitter = retry.jitter ? 'full' : false;
      const breakerCfg = step.breaker || {};
      const breakerKey = breakerCfg && breakerCfg.key ? String(breakerCfg.key) : String(step.id || step.type || 'step');
      const breaker = getBreaker(breakerKey, {
        failThreshold: breakerCfg.failThreshold,
        cooldownMs: breakerCfg.cooldownMs,
        halfOpenMax: breakerCfg.halfOpenMax,
      });

      let attempts = 0;
      let lastFail = null; // 'timeout' | 'rate-limit' | 'error' | 'breaker-open'
      let result = null;
      let ok = false;
      let shortCircuit = false;

      while (attempts < maxAttempts) {
        // Breaker gate before incrementing attempts
        if (!breaker.canPass(nowMs())) {
          lastFail = 'breaker-open';
          shortCircuit = true;
          break;
        }
        attempts++;
        // Rate limit gate per attempt
        if (step.rateLimit && step.rateLimit.key && typeof step.rateLimit.limit === 'number' && typeof step.rateLimit.intervalMs === 'number') {
          const lim = getLimiter(step.rateLimit.key);
          lim.configure({ limit: step.rateLimit.limit, intervalMs: step.rateLimit.intervalMs });
          const allowed = lim.acquire(nowMs());
          if (!allowed) {
            lastFail = 'rate-limit';
            if (attempts < maxAttempts) {
              emit('retry', { id: step.id, attempt: attempts, error: 'rate-limit' });
              stats.retries++;
              const base = backoffs.length ? backoffs[Math.min(attempts - 1, backoffs.length - 1)] : 0;
              const waitMs = jittered(base, `${record.traceId}|${step.id}|${attempts}`, useJitter);
              if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
              continue;
            } else {
              break;
            }
          }
        }

        try {
          result = await withTimeout(handler({ ctx, step }), effectiveTimeoutMs);
          ok = true;
          break;
        } catch (err) {
          const isTimeout = String(err && err.message || err) === 'timeout';
          lastFail = isTimeout ? 'timeout' : 'error';
          if (attempts < maxAttempts) {
            emit('retry', { id: step.id, attempt: attempts, error: isTimeout ? 'timeout' : String(err && err.message || err) });
            stats.retries++;
            const base = backoffs.length ? backoffs[Math.min(attempts - 1, backoffs.length - 1)] : 0;
            const waitMs = backoffNext({ strategy: 'fixed', baseMs: base, maxMs: base, jitter: useJitter, attempt: attempts, seedParts: [record.traceId, step.id, attempts] });
            if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
          }
        }
      }

      const durationMs = metrics.endStep(token);
      metrics.steps++;

      if (ok) {
        breaker.onSuccess();
        metrics.ok++;
        stats.steps++;
        stats.ok++;
        if (estimate) stats.cost += estimate;

        let nextId;
        if (result && result.nextId) nextId = result.nextId;
        else if (step.next) nextId = asArray(step.next)[0];

        record.steps.push({ id: step.id, type: step.type, status: 'ok', durationMs, attempts });
        if (result && result.forkUsed) emit('fork', { from: step.id, nextId });
        emit('step-ok', { id: step.id, type: step.type, durationMs });

        if (nextId) {
          current = stepMap.get(nextId) || null;
        } else {
          current = null; // done
        }
      } else {
        metrics.failed++;
        stats.steps++;
        stats.failed++;
        const reason = lastFail === 'timeout' ? 'timeout' : (lastFail === 'rate-limit' ? 'rate-limit' : (lastFail === 'breaker-open' ? 'breaker-open' : 'retry-exhausted'));
        breaker.onFailure(reason);
        record.steps.push({ id: step.id, type: step.type, status: 'fail', durationMs, attempts, reason });
        emit('step-fail', { id: step.id, type: step.type, error: reason });
        break;
      }
    } catch (error) {
      const durationMs = nowMs() - stepStart;
      metrics.steps++;
      metrics.failed++;
      stats.steps++;
      stats.failed++;
      record.steps.push({ id: step.id, type: step.type, status: 'fail', durationMs, attempts: 1, reason: String(error && error.message || error) });
      emit('step-fail', { id: step.id, type: step.type, error: String(error && error.message || error) });
      break;
    }
  }

  const end = nowMs();
  stats.totalMs = end - start;
  record.finishedAt = new Date(end).toISOString();
  record.final.ctx = ctx;
  emit('done', { totalMs: stats.totalMs });

  return { record, stats, ctx };
}
