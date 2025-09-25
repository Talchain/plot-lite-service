import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function getRunPlot() {
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  return core.runPlot;
}
async function getRegistry() {
  return import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);
}

function listTraces() {
  const dir = path.join(process.cwd(), 'reports', 'warp', 'traces');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => path.join(dir, f));
}

function readJSONL(p) {
  const out = [];
  const text = fs.readFileSync(p, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch {}
  }
  return out;
}

describe('engine trace oracle', () => {
  it('emits step-start → retry → terminal for a top-level retrying step (u1)', async () => {
    // Register minimal steps
    const registry = await getRegistry();
    registry.registerStep('warp-unstable', async ({ ctx, step }) => {
      const until = step && step.inputs && typeof step.inputs.until === 'number' ? step.inputs.until : 0;
      const key = step && (step.id || step.inputs?.key) || 'u1';
      if (!ctx.__tu) Object.defineProperty(ctx, '__tu', { value: Object.create(null), enumerable: false });
      const n = ((ctx.__tu[key] || 0) + 1) | 0;
      ctx.__tu[key] = n;
      if (n <= until) throw new Error('unstable-fail');
      return { ctx };
    });

    const runPlot = await getRunPlot();

    const before = new Set(listTraces());
    const prev = process.env.ENGINE_TRACE;
    process.env.ENGINE_TRACE = '1';

    const plot = {
      id: 'trace-u1', version: '1',
      steps: [ { id: 'u1', type: 'warp-unstable', inputs: { until: 1 }, retry: { max: 2, backoffMs: [0], jitter: false } } ]
    };
    await runPlot(plot, {});

    // Restore env
    if (prev === undefined) delete process.env.ENGINE_TRACE; else process.env.ENGINE_TRACE = prev;

    const after = new Set(listTraces());
    const added = [...after].filter(p => !before.has(p));
    const file = added.length ? added.sort().pop() : [...after].sort().pop();
    expect(!!file).toBe(true);

    const events = readJSONL(file).filter(e => e && e.ev && e.id === 'u1');
    const hasStart = events.some(e => e.ev === 'step-start');
    const hasRetry = events.some(e => e.ev === 'retry');
    const hasTerminal = events.some(e => e.ev === 'step-ok' || e.ev === 'step-fail');
    expect(hasStart && hasRetry && hasTerminal).toBe(true);

    // Also ensure file has a 'done' event somewhere
    const all = readJSONL(file);
    expect(all.some(e => e.ev === 'done')).toBe(true);
  }, 10000);
});