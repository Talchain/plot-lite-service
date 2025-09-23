#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function median(a) { const b = [...a].sort((x,y)=>x-y); const m = Math.floor(b.length/2); return b.length? (b.length%2? b[m] : (b[m-1]+b[m])/2) : 0; }
function p(a, p) { if (!a.length) return 0; const b = [...a].sort((x,y)=>x-y); const idx = Math.min(b.length-1, Math.floor((p/100)*b.length)); return b[idx]; }

async function loadRunPlot() {
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  return core.runPlot;
}

async function main() {
  const runPlot = await loadRunPlot();
  // build a 1000-step transform-only plot
  const steps = [];
  for (let i=0;i<1000;i++) steps.push({ id: `s${i}`, type: 'transform', inputs: { assign: { n: i } }, next: i<999? `s${i+1}` : undefined });
  const plot = { id: 'bench-1000', version: '1', steps };

  const allDurations = [];
  for (let r=0;r<3;r++) {
    const { record } = await runPlot(plot, {});
    for (const s of record.steps) if (typeof s.durationMs === 'number') allDurations.push(s.durationMs);
  }
  const outDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const result = {
    runs: 3,
    stepsPerRun: 1000,
    perStepMs: {
      mean: Number(mean(allDurations).toFixed(3)),
      median: Number(median(allDurations).toFixed(3)),
      p95: Number(p(allDurations,95).toFixed(3))
    }
  };
  fs.writeFileSync(path.join(outDir, 'bench-engine.json'), JSON.stringify(result, null, 2));
  console.log('Wrote reports/bench-engine.json');
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
