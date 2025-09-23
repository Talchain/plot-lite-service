#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tools/plot-run.cjs <plot.json>');
    process.exit(1);
  }
  const full = path.resolve(process.cwd(), file);
  const plot = JSON.parse(fs.readFileSync(full, 'utf8'));
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  const outDir = path.resolve(process.cwd(), 'reports', 'runs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(outDir, `${ts}-${plot.id || 'unknown'}.json`);
  const events = [];
  const onEvent = (e) => { events.push(e); };
  const { record, stats, ctx } = await core.runPlot(plot, { input: {}, onEvent });
  const payload = { record, stats, ctx, events };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log('Wrote', out);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
