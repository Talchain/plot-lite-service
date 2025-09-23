#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function parseArgs(argv) {
  const args = argv.slice(2);
  let file = null;
  const opts = { };
  for (const a of args) {
    if (a.startsWith('--')) {
      const [k, vRaw] = a.split('=');
      const v = vRaw == null ? '' : vRaw;
      if (k === '--maxMs') {
        const n = Number(v);
        if (!Number.isNaN(n)) opts.maxDurationMs = n;
      } else if (k === '--maxCost') {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          opts.budget = opts.budget || {};
          opts.budget.maxCost = n;
        }
      } else if (k === '--report') {
        if (v) opts.report = v;
      }
    } else if (!file) {
      file = a;
    }
  }
  return { file, opts };
}

async function main() {
  const { file, opts } = parseArgs(process.argv);
  if (!file) {
    console.error('Usage: node tools/plot-run.cjs <plot.json> [--maxMs=<int>] [--maxCost=<num>] [--report=<path>]');
    process.exit(1);
  }
  const full = path.resolve(process.cwd(), file);
  const plot = JSON.parse(fs.readFileSync(full, 'utf8'));
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  const outDirDefault = path.resolve(process.cwd(), 'reports', 'runs');
  if (!fs.existsSync(outDirDefault)) fs.mkdirSync(outDirDefault, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOut = path.join(outDirDefault, `${ts}-${plot.id || 'unknown'}.json`);
  const out = opts.report ? path.resolve(process.cwd(), opts.report) : defaultOut;
  const outDir = path.dirname(out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const events = [];
  const onEvent = (e) => { events.push(e); };
  const { record, stats, ctx } = await core.runPlot(plot, { input: {}, onEvent, maxDurationMs: opts.maxDurationMs, budget: opts.budget });
  const payload = { record, stats, ctx, events };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log('Wrote', out);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
