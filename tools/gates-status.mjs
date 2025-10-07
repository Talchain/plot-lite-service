#!/usr/bin/env node
/**
 * gates-status.mjs
 * Generate a concise status card for CI and local runs.
 * - Runs contract, SLO, privacy gates, capturing exactly one GATES: line each.
 * - Fetches latest self-check hash by spinning up the server briefly.
 * - Writes GATES_STATUS.md with test counts (best-effort), self-check hash, and gate lines.
 */

import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';

function runGate(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const line = out.split('\n').find(l => l.startsWith('GATES:')) || '';
  const code = res.status ?? 1;
  return { line: line.trim(), code };
}

async function fetchSelfCheckHash() {
  const PORT = 4341;
  const HOST = '127.0.0.1';
  const BASE = `http://${HOST}:${PORT}`;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function waitForHealth(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = await fetch(`${BASE}/v1/health`); if (res.ok) return true; } catch {}
      await sleep(100);
    }
    return false;
  }

  const child = spawn('node', ['dist/main.js'], {
    env: { ...process.env, TEST_ROUTES: '1', AUTH_ENABLED: '0', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(`/tmp/engine-status-${PORT}.log`);
  child.stdout.pipe(log); child.stderr.pipe(log);

  const healthy = await waitForHealth(8000);
  if (!healthy) { try { child.kill(); } catch {} return 'unavailable'; }
  try {
    const res = await fetch(`${BASE}/v1/self-check`);
    const js = await res.json();
    return js?.hash || 'unknown';
  } catch {
    return 'unknown';
  } finally {
    try { child.kill(); } catch {}
  }
}

function readVitestSummary() {
  // Best effort: if a JSON summary is produced somewhere, read it. Otherwise unknown.
  // Placeholder path example (not guaranteed): artifact/vitest-summary.json
  const p = resolve(process.cwd(), 'artifact', 'vitest-summary.json');
  if (!existsSync(p)) return { total: 'unknown', passed: 'unknown', failed: 'unknown' };
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { total: j?.stats?.tests ?? 'unknown', passed: j?.stats?.passed ?? 'unknown', failed: j?.stats?.failed ?? 'unknown' };
  } catch {
    return { total: 'unknown', passed: 'unknown', failed: 'unknown' };
  }
}

(async () => {
  // Run all v0.3.6 gates
  const contract = runGate('node', ['tools/contract-drift-gate.mjs']);
  const slo = runGate('node', ['tools/gates/06-slos-perf.mjs']);
  const determinism = runGate('node', ['tools/gates/07-determinism.mjs']);
  const privacy = runGate('node', ['tools/privacy-gate.mjs']);
  const pack = runGate('node', ['tools/gates/09-engine-pack.mjs']);
  const trust = runGate('node', ['tools/gates/10-trust-chain.mjs']);
  const schema = runGate('node', ['tools/gates/11-schema-risk.mjs']);
  const repro = runGate('node', ['tools/gates/00-repro-matrix.mjs']);

  const hash = await fetchSelfCheckHash();
  const tests = readVitestSummary();

  const lines = [
    contract.line,
    slo.line,
    determinism.line,
    privacy.line,
    pack.line,
    trust.line,
    schema.line,
    repro.line
  ].filter(Boolean);

  const passCount = lines.filter(l => /GATES: PASS/.test(l)).length;
  const failCount = lines.filter(l => /GATES: FAIL/.test(l)).length;

  const md = `# Gates Status (v0.3.6)\n\n` +
`- **Tests**: total=${tests.total}, passed=${tests.passed}, failed=${tests.failed}\n` +
`- **Self-check hash**: ${hash}\n\n` +
`## Gate Results\n` +
lines.map(l => `- ${l}`).join('\n') + `\n\n` +
`- **Passes**: ${passCount}\n- **Fails**: ${failCount}\n`;

  writeFileSync('GATES_STATUS.md', md, 'utf8');
  console.log(`GATES: PASS — status reports generated (passes=${passCount}, fails=${failCount})`);
})();
