#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { pathToFileURL } = require('url');

async function loadRunPlot() {
  const core = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/core.js')).href);
  return core.runPlot;
}

async function runCase(name, fn) {
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, ms: Date.now() - start };
  } catch (e) {
    return { name, ok: false, error: String(e && e.message || e), ms: Date.now() - start };
  }
}

async function main() {
  const runPlot = await loadRunPlot();
  const cases = [];

  const testsDir = path.resolve(process.cwd(), 'test', 'engine');
  const files = fs.existsSync(testsDir) ? fs.readdirSync(testsDir).filter(f => f.endsWith('.cjs')) : [];
  for (const f of files) {
    const mod = require(path.join(testsDir, f));
    const testFn = typeof mod === 'function' ? mod : (mod && (mod.run || mod.runTest || mod.default));
    if (typeof testFn === 'function') {
      cases.push(await runCase(f, () => testFn({ runPlot, assert })));
    }
  }

  const summary = {
    total: cases.length,
    ok: cases.filter(c => c.ok).length,
    failed: cases.filter(c => !c.ok).length,
    timestamp: new Date().toISOString()
  };
  const outDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tests.json'), JSON.stringify({ summary, cases }, null, 2));
  console.log(`Tests: ${summary.ok}/${summary.total} ok`);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
