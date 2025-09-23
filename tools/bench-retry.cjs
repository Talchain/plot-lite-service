#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) { const b = [...a].sort((x,y)=>x-y); const m = Math.floor(b.length/2); return b.length? (b.length%2? b[m] : (b[m-1]+b[m])/2) : 0; }
function p(a, pv) { if (!a.length) return 0; const b = [...a].sort((x,y)=>x-y); const idx = Math.min(b.length-1, Math.floor((pv/100)*b.length)); return b[idx]; }

async function loadModules() {
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  const registry = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);
  return { runPlot: core.runPlot, registerStep: registry.registerStep };
}

// Simple deterministic PRNG for repeatability
let seed = 123456789;
function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; }

async function main() {
  const { runPlot, registerStep } = await loadModules();

  // Register a local 'flaky' step type to simulate failures deterministically.
  registerStep('flaky', async ({ ctx, step }) => {
    const pFail = step && step.inputs && typeof step.inputs.pFail === 'number' ? step.inputs.pFail : 0.5;
    const r = rand();
    if (r < pFail) throw new Error('flaky fail');
    return { ctx };
  });

  const plot = { id: 'bench-retry', version: '1', steps: [ { id: 'one', type: 'flaky', inputs: { pFail: 0.5 } } ] };

  const runs = 200;
  const maxAttempts = 3;
  const attemptDurations = [];
  const attemptsPerRun = [];
  let successes = 0;

  for (let r = 0; r < runs; r++) {
    let ok = false;
    let used = 0;
    for (let a = 1; a <= maxAttempts; a++) {
      used = a;
      const { record } = await runPlot(plot, {});
      const step = record && Array.isArray(record.steps) ? record.steps[0] : null;
      if (step && typeof step.durationMs === 'number') attemptDurations.push(step.durationMs);
      if (step && step.status === 'ok') { ok = true; break; }
    }
    if (ok) successes++;
    attemptsPerRun.push(used);
  }

  const outDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const result = {
    runs,
    maxAttempts,
    successRate: Number((successes / runs).toFixed(4)),
    attemptsPerRun: {
      mean: Number(mean(attemptsPerRun).toFixed(3)),
      median: Number(median(attemptsPerRun).toFixed(3)),
      p95: Number(p(attemptsPerRun,95).toFixed(3))
    },
    perAttemptMs: {
      mean: Number(mean(attemptDurations).toFixed(3)),
      median: Number(median(attemptDurations).toFixed(3)),
      p95: Number(p(attemptDurations,95).toFixed(3))
    }
  };
  fs.writeFileSync(path.join(outDir, 'bench-retry.json'), JSON.stringify(result, null, 2));
  console.log('Wrote reports/bench-retry.json');
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
