import { registerStep } from '../registry.js';
import { get } from '../util.js';
import { runStepCore } from '../stepRunner.js';

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!Object.prototype.hasOwnProperty.call(cur, p) || cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

export async function handleFanout({ ctx, step }) {
  const inputs = step.inputs || {};
  const caps = (ctx && ctx.__runCaps) ? ctx.__runCaps : {};
  const deadlineAt = caps && typeof caps.deadlineAt === 'number' ? caps.deadlineAt : null;
  const traceId = caps && caps.traceId ? String(caps.traceId) : 'fanout';

  function timeLeft() {
    return deadlineAt == null ? Infinity : Math.max(0, deadlineAt - Date.now());
  }

  async function withTimeout(promise, ms) {
    if (!ms || ms === Infinity) return promise;
    let to;
    const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout')), Math.max(1, ms|0)); });
    try {
      const res = await Promise.race([promise, timeout]);
      clearTimeout(to);
      return res;
    } catch (e) {
      clearTimeout(to);
      throw e;
    }
  }

  const fromPath = String(inputs.fromPath || '').trim();
  if (!fromPath) throw new Error('fromPath required');
  const itemPath = (typeof inputs.itemPath === 'string' && inputs.itemPath.trim()) ? inputs.itemPath.trim() : 'item';
  const steps = Array.isArray(inputs.steps) ? inputs.steps : [];
  const concurrency = Math.max(1, Number(inputs.concurrency) || 1);
  const stopOnFirstError = inputs.stopOnFirstError === undefined ? true : !!inputs.stopOnFirstError;

  const items = get(ctx, fromPath);
  if (!Array.isArray(items)) throw new Error('fromPath must resolve to array');

  let nextIndex = 0;
  let cancelled = false;
  const failures = [];

  async function runChild(index) {
    const childCtx = { ...ctx };
    try { if (caps) Object.defineProperty(childCtx, '__runCaps', { value: caps, enumerable: false, configurable: true }); } catch {}
    setPath(childCtx, itemPath, items[index]);
    for (const s of steps) {
      const tl = timeLeft();
      if (tl <= 0) throw new Error('timeout');
      const res = await runStepCore({ ctx: childCtx, step: s, caps, traceId });
      if (!res.ok) throw new Error(res.reason || 'error');
    }
  }

  async function worker() {
    while (!cancelled) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        await runChild(i);
      } catch (e) {
        failures.push({ index: i, reason: String(e && e.message || e) });
        if (stopOnFirstError) {
          cancelled = true;
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  if (failures.length > 0 && stopOnFirstError) {
    throw new Error('fanout-failed');
  }

  return { ctx };
}

registerStep('fanout', handleFanout);
