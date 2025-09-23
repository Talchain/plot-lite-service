#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) { const b = [...a].sort((x,y)=>x-y); const m = Math.floor(b.length/2); return b.length? (b.length%2? b[m] : (b[m-1]+b[m])/2) : 0; }
function p(a, pv) { if (!a.length) return 0; const b = [...a].sort((x,y)=>x-y); const idx = Math.min(b.length-1, Math.floor((pv/100)*b.length)); return b[idx]; }

async function loadRunPlot() {
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  return core.runPlot;
}

async function main() {
  const runPlot = await loadRunPlot();
  // Build a 1000-step predicate-heavy plot using `gate` with a fork condition
  const steps = [];
  for (let i = 0; i < 1000; i++) {
    steps.push({
      id: `g${i}`,
      type: 'gate',
      fork: {
        condition: '${score} >= 0.5',
        onTrue: i < 999 ? `g${i+1}` : undefined,
        onFalse: i < 999 ? `g${i+1}` : undefined
      }
    });
  }
  const plot = { id: 'bench-predicate-1000', version: '1', steps };

  const allDurations = [];
  const runs = 3;
  for (let r = 0; r < runs; r++) {
    const { record } = await runPlot(plot, { input: { score: 0.7 } });
    for (const s of record.steps) if (typeof s.durationMs === 'number') allDurations.push(s.durationMs);
  }

  const outDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const result = {
    runs,
    stepsPerRun: 1000,
    perStepMs: {
      mean: Number(mean(allDurations).toFixed(3)),
      median: Number(median(allDurations).toFixed(3)),
      p95: Number(p(allDurations,95).toFixed(3))
    }
  };
  fs.writeFileSync(path.join(outDir, 'bench-predicate.json'), JSON.stringify(result, null, 2));
  console.log('Wrote reports/bench-predicate.json');
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
