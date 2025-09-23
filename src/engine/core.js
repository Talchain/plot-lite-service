import { createMetrics } from './metrics.js';
import { getStepHandler } from './registry.js';
import { nowMs } from './util.js';
// ensure built-in steps are registered
import './steps/transform.js';
import './steps/gate.js';

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

export async function runPlot(plot, { input = {}, onEvent, maxDurationMs = 30000, traceId } = {}) {
  const start = nowMs();
  const ctx = { ...input };
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
  const stats = { totalMs: 0, steps: 0, ok: 0, failed: 0 };

  const emit = (type, data = {}) => { if (typeof onEvent === 'function') try { onEvent({ type, ...data }); } catch {} };

  while (current) {
    const step = current;
    const handler = getStepHandler(step.type);
    const token = metrics.startStep(step.id);
    const stepStart = nowMs();
    emit('step-start', { id: step.id, type: step.type });

    try {
      if (!handler) throw new Error(`no handler for step type: ${step.type}`);
      const timeoutMs = Math.min(step.timeoutMs || maxDurationMs, maxDurationMs);
      const result = await withTimeout(handler({ ctx, step }), timeoutMs);
      const durationMs = metrics.endStep(token);
      metrics.steps++;
      metrics.ok++;
      stats.steps++;
      stats.ok++;

      let nextId;
      if (result && result.nextId) nextId = result.nextId;
      else if (step.next) nextId = asArray(step.next)[0];

      record.steps.push({ id: step.id, type: step.type, status: 'ok', durationMs });
      if (result && result.forkUsed) emit('fork', { from: step.id, nextId });
      emit('step-ok', { id: step.id, type: step.type, durationMs });

      if (nextId) {
        current = stepMap.get(nextId) || null;
      } else {
        current = null; // done
      }
    } catch (error) {
      const durationMs = nowMs() - stepStart;
      metrics.steps++;
      metrics.failed++;
      stats.steps++;
      stats.failed++;
      record.steps.push({ id: step.id, type: step.type, status: 'fail', durationMs, error: String(error && error.message || error) });
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
