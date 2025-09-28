#!/usr/bin/env node
import { runProbe } from './loadcheck-probe.cjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

(async () => {
  try {
    const res = await runProbe({});
    mkdirSync('reports', { recursive: true });
    mkdirSync('reports/warp', { recursive: true });
    const out = { timestamp: new Date().toISOString(), budget_ms: 600, ...res, over_budget: (res.p95_ms ?? 0) > 600, probe_exit_code: 0, error_name: null, error_message: null };
    writeFileSync(resolvePath('reports', 'loadcheck.json'), JSON.stringify(out, null, 2), 'utf8');
    writeFileSync(resolvePath('reports/warp', 'loadcheck.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('loadcheck ok', out);
    process.exit(0);
  } catch (e) {
    const out = { timestamp: new Date().toISOString(), budget_ms: 600, p95_ms: null, over_budget: true, probe_exit_code: 1, error_name: e?.name || 'Error', error_message: e?.message || String(e) };
    try {
      mkdirSync('reports', { recursive: true });
      writeFileSync(resolvePath('reports', 'loadcheck.json'), JSON.stringify(out, null, 2), 'utf8');
    } catch {}
    console.error('loadcheck failed', e);
    process.exit(1);
  }
})();
