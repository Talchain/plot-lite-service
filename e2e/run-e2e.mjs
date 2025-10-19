#!/usr/bin/env node
import {fileURLToPath} from 'url';
import {dirname, join} from 'path';
import {writeFileSync, mkdirSync} from 'fs';
import {renderMarkdown} from './lib/markdown-reporter.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const scenarios = ['01-happy-path', '02-burst-trip', '03-half-open', '04-isolation', '05-degraded'];
(async () => {
  const results = [];
  for (const name of scenarios) {
    const mod = await import(join(__dirname, 'scenarios', name + '.ts')).catch(() => import(join(__dirname, 'scenarios', name + '.js')));
    const start = performance.now();
    const assert = await mod.default(BASE);
    const dur = performance.now() - start;
    const sum = assert.summary();
    results.push({name, dur, sum, details: assert.all});
    console.log(`[${assert.pass ? 'PASS' : 'FAIL'}] ${name} (${dur.toFixed(1)}ms): ${sum.passed}/${sum.total}`);
  }
  mkdirSync(join(__dirname, 'reports'), {recursive: true});
  writeFileSync(join(__dirname, 'reports/summary.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(__dirname, 'reports/summary.md'), renderMarkdown(results));
  const failed = results.filter(r => r.sum.failed > 0).length;
  process.exit(failed ? 1 : 0);
})();
