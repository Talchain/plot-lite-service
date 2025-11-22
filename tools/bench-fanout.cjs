#!/usr/bin/env node
// Simple local benchmark for fanout concurrency. Not part of CI.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const args = process.argv.slice(2);
  const params = { items: 100, ms: 2, concurrencies: [1, 2, 4, 8] };
  for (const a of args) {
    if (a.startsWith('--items=')) params.items = Number(a.split('=')[1]) || params.items;
    else if (a.startsWith('--ms=')) params.ms = Number(a.split('=')[1]) || params.ms;
    else if (a.startsWith('--concurrency=')) params.concurrencies = (a.split('=')[1]||'').split(',').map(x=>Number(x)||1).filter(Boolean);
  }

  const registry = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);
  // Register a sleep step locally
  registry.registerStep('sleep', async ({ step }) => {
    const ms = step && step.inputs && typeof step.inputs.ms === 'number' ? step.inputs.ms : 0;
    await new Promise(r => setTimeout(r, ms));
    return {};
  });

  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);

  const baseSteps = [
    { id: 'init', type: 'transform', inputs: { assign: { items: Array.from({ length: params.items }, (_,i)=>i) } }, next: 'fo' },
    { id: 'fo', type: 'fanout', inputs: { fromPath: 'items', itemPath: 'item', steps: [ { type: 'sleep', inputs: { ms: params.ms } } ] } }
  ];

  const results = [];
  for (const c of params.concurrencies) {
    const plot = { id: `bench-fanout-c${c}`, version: '1', steps: JSON.parse(JSON.stringify(baseSteps)) };
    plot.steps[1].inputs.concurrency = c;
    const t0 = Date.now();
    await core.runPlot(plot, { maxDurationMs: 600000 });
    const dt = Date.now() - t0;
    results.push({ concurrency: c, ms: dt });
  }

  const outDir = path.resolve(process.cwd(), 'reports', 'warp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'fanout-bench.json');
  const payload = { timestamp: new Date().toISOString(), params, results };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log('Fanout bench written:', out);
  for (const r of results) console.log(`c=${r.concurrency} → ${r.ms} ms`);
}

main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
