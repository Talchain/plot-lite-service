import { describe, it, expect } from 'vitest';
import assert from 'node:assert';
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

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

function lcg(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }
function int(rnd, min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
function bool(rnd) { return rnd() < 0.5; }

async function registerTestSteps() {
  const registry = await getRegistry();
  // warp-unstable: fails for N attempts then succeeds; per-run counter stored in ctx
  registry.registerStep('warp-unstable', async ({ ctx, step }) => {
    const until = step && step.inputs && typeof step.inputs.until === 'number' ? step.inputs.until : 0;
    const key = (step && (step.id || step.inputs?.key)) || 'u';
    if (!ctx.__warpUnstable) Object.defineProperty(ctx, '__warpUnstable', { value: Object.create(null), enumerable: false, configurable: true });
    const n = ((ctx.__warpUnstable[key] || 0) + 1) | 0;
    ctx.__warpUnstable[key] = n;
    if (n <= until) throw new Error('unstable-fail');
    return { ctx };
  });
  // warp-maybeFail: fails if ctx.item === 'boom'
  registry.registerStep('warp-maybeFail', async ({ ctx }) => {
    if (ctx && ctx.item === 'boom') throw new Error('boom');
    return { ctx };
  });
  // warp-sleep: await ms (default 0)
  registry.registerStep('warp-sleep', async ({ step }) => {
    const ms = step && step.inputs && typeof step.inputs.ms === 'number' ? step.inputs.ms : 0;
    if (ms > 0) await new Promise(r => setTimeout(r, ms));
    return {};
  });
}

function buildCase(seed) {
  const rnd = lcg(seed);
  const retryMax = int(rnd, 0, 4);
  const backoffOptions = [[], [0], [1], [2, 2], [5]]; // keep tiny for speed
  const backoffMs = pick(rnd, backoffOptions);
  const jitter = bool(rnd);
  const breaker = { failThreshold: pick(rnd, [1, 2, 3]), cooldownMs: pick(rnd, [1, 10, 50]), halfOpenMax: pick(rnd, [1, 2]) };
  const useRL = rnd() < 0.4;
  const rateLimit = useRL ? { key: 'k', limit: pick(rnd, [1, 2]), intervalMs: pick(rnd, [10, 20]) } : null;
  const useDeadline = rnd() < 0.5;
  const deadline = useDeadline ? int(rnd, 40, 120) : null;
  const itemsLen = pick(rnd, [1, 2, 4, 8]);
  const stopOnFirstError = bool(rnd);
  const concurrency = pick(rnd, [1, 2, 4, 8]);

  const items = Array.from({ length: itemsLen }, (_, i) => i);
  if (stopOnFirstError) {
    // inject early booms deterministically if length permits
    if (items.length >= 1) items[0] = 'boom';
    if (items.length >= 3) items[2] = 'boom';
  }

  const plot = {
    id: 'fuzz', version: '1',
    steps: [
      { id: 'prep', type: 'transform', inputs: { assign: { items } }, next: useRL && rateLimit && rateLimit.limit === 1 ? 'rlProbe' : 'u1' },
      ...(useRL && rateLimit && rateLimit.limit === 1 ? [
        { id: 'rlProbe', type: 'warp-sleep', inputs: { ms: 0 }, rateLimit, next: 'u1' }
      ] : []),
      { id: 'u1', type: 'warp-unstable', inputs: { until: int(rnd, 0, retryMax + 2), key: 'u1' }, retry: { max: retryMax, backoffMs, jitter }, ...(rateLimit ? { rateLimit } : {}), breaker },
      { id: 'fo', type: 'fanout', inputs: { fromPath: 'items', itemPath: 'item', concurrency, stopOnFirstError, steps: [ { type: 'warp-maybeFail' }, { type: 'warp-sleep', inputs: { ms: 0 } } ] } }
    ]
  };
  const caps = deadline != null ? { maxDurationMs: deadline } : {};
  const input = {};
  return { seed, plot, input, caps, cfg: { retryMax, backoffMs, jitter, breaker, rateLimit, deadline, concurrency, stopOnFirstError, itemsLen } };
}

function allowedReason(reason) {
  return ['timeout', 'rate-limit', 'breaker-open', 'retry-exhausted', 'budget-exceeded', 'fanout-failed'].includes(reason);
}

describe('engine conformance fuzz (seeded)', () => {
  it('runs 1000 randomized cases within 10s and enforces invariants', async () => {
    await registerTestSteps();
    const runPlot = await getRunPlot();

    const start = Date.now();
    let failures = 0; let captured = false;
    ensureDir(path.resolve(process.cwd(), 'reports', 'warp'));

    for (let i = 0; i < 1000; i++) {
      const seed = 1000 + i;
      const { plot, input, caps, cfg } = buildCase(seed);
      try {
        const { record, stats } = await runPlot(plot, { input, ...caps });
        // accounting
        expect(Array.isArray(record.steps)).toBe(true);
        expect(stats.steps).toBe(record.steps.length);
        expect(stats.ok + stats.failed).toBe(stats.steps);
        for (const s of record.steps) {
          expect(typeof s.durationMs).toBe('number');
          // attempts may be 0 if run-level deadline hit before first attempt
          const minAttempts = s.status === 'ok' ? 1 : 0;
          expect(s.attempts).toBeGreaterThanOrEqual(minAttempts);
        }
        const sumAttemptsMinus1 = record.steps.reduce((acc, s) => acc + Math.max(0, (s.attempts || 0) - 1), 0);
        expect(stats.retries).toBeGreaterThanOrEqual(sumAttemptsMinus1);

        const u1 = record.steps.find(s => s.id === 'u1');
        expect(!!u1).toBe(true);
        if (cfg.retryMax === 0 && u1.status === 'ok') {
          expect(u1.attempts).toBe(1);
        }
        // Rate limit observation: if we pre-consumed a token and disallow retries, u1 may fail quickly
        // Do not require failure (window may roll or be very short); only constrain reason if it fails.
        if (cfg.rateLimit && cfg.rateLimit.limit === 1 && cfg.retryMax === 0) {
          if (u1.status === 'fail' && u1.reason) {
            expect(['rate-limit', 'retry-exhausted']).toContain(u1.reason);
          }
        }
        // Allowed reasons only
        for (const s of record.steps) {
          if (s.status === 'fail' && s.reason) expect(allowedReason(s.reason)).toBe(true);
        }

        // Metamorphic checks for a sparse subset
        if (seed % 17 === 0) {
          // Backoff monotonicity (jitter=false)
          const basePlot = JSON.parse(JSON.stringify(plot));
          basePlot.steps = basePlot.steps.map(st => st.id === 'u1' ? { ...st, retry: { max: Math.max(2, cfg.retryMax), backoffMs: [0], jitter: false } } : st);
          const incPlot = JSON.parse(JSON.stringify(plot));
          incPlot.steps = incPlot.steps.map(st => st.id === 'u1' ? { ...st, retry: { max: Math.max(2, cfg.retryMax), backoffMs: [5], jitter: false } } : st);
          const A = await runPlot(basePlot, { input, ...caps });
          const B = await runPlot(incPlot, { input, ...caps });
          const Au1 = A.record.steps.find(s => s.id === 'u1');
          const Bu1 = B.record.steps.find(s => s.id === 'u1');
          expect(Bu1.durationMs).toBeGreaterThanOrEqual(Au1.durationMs);

          // Breaker strictness: stricter breaker cannot increase attempts
          const loose = JSON.parse(JSON.stringify(plot));
          loose.steps = loose.steps.map(st => st.id === 'u1' ? { ...st, breaker: { failThreshold: 3, cooldownMs: 10, halfOpenMax: 1 }, retry: { max: Math.max(2, cfg.retryMax), backoffMs: [0], jitter: false }, inputs: { ...st.inputs, until: Math.max(3, (st.inputs?.until||0) + 3) } } : st);
          const strict = JSON.parse(JSON.stringify(plot));
          strict.steps = strict.steps.map(st => st.id === 'u1' ? { ...st, breaker: { failThreshold: 1, cooldownMs: 10, halfOpenMax: 1 }, retry: { max: Math.max(2, cfg.retryMax), backoffMs: [0], jitter: false }, inputs: { ...st.inputs, until: Math.max(3, (st.inputs?.until||0) + 3) } } : st);
          const L = await runPlot(loose, { input, ...caps });
          const S = await runPlot(strict, { input, ...caps });
          const Lu1 = L.record.steps.find(s => s.id === 'u1');
          const Su1 = S.record.steps.find(s => s.id === 'u1');
          expect(Su1.attempts).toBeLessThanOrEqual(Lu1.attempts);

          // Deadline monotonicity: smaller deadline should not increase steps run
          if (cfg.deadline && cfg.deadline > 20) {
            const C = await runPlot(plot, { input, maxDurationMs: cfg.deadline });
            const D = await runPlot(plot, { input, maxDurationMs: Math.max(1, Math.floor(cfg.deadline / 2)) });
            expect(D.record.steps.length).toBeLessThanOrEqual(C.record.steps.length);
          }
        }
      } catch (e) {
        failures++;
        if (!captured) {
          captured = true;
          const repro = buildCase(seed);
          const outDir = path.resolve(process.cwd(), 'reports', 'warp');
          ensureDir(outDir);
          fs.writeFileSync(path.join(outDir, `fuzz-repro-${seed}.json`), JSON.stringify(repro, null, 2));
          fs.writeFileSync(path.join(outDir, 'fuzz-last.json'), JSON.stringify(repro, null, 2));
        }
        throw new Error(`fuzz seed ${seed}: ${String(e && e.message || e)}`);
      }
    }

    const dt = Date.now() - start;
    expect(failures).toBe(0);
    expect(dt).toBeLessThan(10000);
  }, 20000);
});