import { registerStep, getStepHandler } from '../registry.js';
import { get } from '../util.js';

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
    setPath(childCtx, itemPath, items[index]);
    // run sub-steps linearly using registered handlers
    for (const s of steps) {
      const h = getStepHandler(s.type);
      if (!h) throw new Error(`no handler for step type: ${s.type}`);
      await h({ ctx: childCtx, step: s });
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
