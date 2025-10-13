#!/usr/bin/env node
/**
 * gates-status.mjs (clean)
 * Dev-fast rollup of key gates (not the full CI set). Some heavy gates are omitted to keep
 * local runs quick and deterministic; the full list runs in CI. This script:
 * - Runs contract, SLO, privacy, self-check and smoke-ish gates
 * - Captures each gate's single GATES line
 * - Fetches latest self-check hash
 * - Writes GATES_STATUS.md and emits exactly one final GATES line
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
  const contract = runGate('node', ['tools/contract-drift-gate.mjs']);
  const openapiLint = runGate('node', ['tools/openapi-lint-gate.mjs']);
  const slo = runGate('node', ['tools/slo-budget-gate.mjs']);
  const privacy = runGate('node', ['tools/privacy-gate.mjs']);
  // Guard ttff collector (optional in some workspaces)
  const ttffPath = resolve(process.cwd(), 'tools', 'ttff-collect.mjs');
  const ttff = existsSync(ttffPath)
    ? runGate('node', ['tools/ttff-collect.mjs'])
    : { line: 'GATES: SKIP — ttff-collect (missing script)', code: 0 };
  const prov = runGate('node', ['tools/provenance-gate.mjs']);
  const traceGate = runGate('node', ['tools/trace-id-gate.mjs']);
  const healthEnrichGate = runGate('node', ['tools/health-enrich-gate.mjs']);
  const sdkJsGate = runGate('node', ['tools/sdk-js-smoke.mjs']);
  const runtimeConsGate = runGate('node', ['tools/runtime-consistency-gate.mjs']);
  const bench = runGate('node', ['tools/rollout-bench.mjs']);
  const benchThresh = runGate('node', ['tools/rollout-threshold-gate.mjs']);
  const loadBench = runGate('node', ['tools/load-bench.mjs']);
  const sdk = runGate('node', ['tools/sdk-smoke.mjs']);
  const chaos = runGate('node', ['tools/chaos-smoke.mjs']);
  const chaosAuth = runGate('node', ['tools/chaos-auth-smoke.mjs']);
  const healthGate = runGate('node', ['tools/health-gate.mjs']);
  const selfcheckGate = runGate('node', ['tools/self-check-gate.mjs']);
  const streamRateGate = runGate('node', ['tools/stream-rate-limit-gate.mjs']);
  const trustProxyGate = runGate('node', ['tools/trust-proxy-gate.mjs']);
  const sdkPyGate = runGate('node', ['tools/sdk-smoke:python.mjs']);
  const streamChaosGate = runGate('node', ['tools/stream-chaos-halfclose-gate.mjs']);
  const ttffSampleGate = runGate('node', ['tools/ttff-sample-gate.mjs']);
  const hash = await fetchSelfCheckHash();
  const tests = readVitestSummary();

  const lines = [
    contract.line,
    openapiLint.line,
    prov.line,
    traceGate.line,
    healthEnrichGate.line,
    sdkJsGate.line,
    sdkPyGate.line,
    runtimeConsGate.line,
    streamChaosGate.line,
    ttffSampleGate.line,
    slo.line,
    privacy.line,
    ttff.line,
    bench.line,
    benchThresh.line,
    loadBench.line,
    sdk.line,
    chaos.line,
    chaosAuth.line,
    healthGate.line,
    selfcheckGate.line,
    streamRateGate.line,
    trustProxyGate.line,
  ].filter(Boolean);
  const passCount = lines.filter(l => /GATES: PASS/.test(l)).length;
  const failCount = lines.filter(l => /GATES: FAIL/.test(l)).length;

  const md = `# Gates Status\n\n` +
`- **Tests**: total=${tests.total}, passed=${tests.passed}, failed=${tests.failed}\n` +
`- **Self-check hash**: ${hash}\n\n` +
`## Gate Results\n` +
lines.map(l => `- ${l}`).join('\n') + `\n\n` +
`- **Passes**: ${passCount}\n- **Fails**: ${failCount}\n`;

  writeFileSync('GATES_STATUS.md', md, 'utf8');
  // Append to GitHub Step Summary if available (with Performance section)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const artifactDir = resolve(process.cwd(), 'artifact');
      let slos = {};
      try { slos = JSON.parse(fs.readFileSync(resolve(artifactDir, 'slos.json'), 'utf8')); } catch {}
      let benchObj = {};
      try { benchObj = JSON.parse(fs.readFileSync(resolve(artifactDir, 'bench', 'rollout.json'), 'utf8')); } catch {}
      let loadObj = {};
      try { loadObj = JSON.parse(fs.readFileSync(resolve(artifactDir, 'bench', 'load.json'), 'utf8')); } catch {}
      // find latest pack zip
      let packPath = '';
      let packSha256 = '';
      let packTs = '';
      try {
        const files = fs.readdirSync(artifactDir).filter(f => /^engine_pack_.*\.zip$/.test(f)).sort();
        if (files.length) packPath = 'artifact/' + files[files.length - 1];
      } catch {}
      // compute sha256 if pack found
      if (packPath) {
        try {
          const { createHash } = await import('node:crypto');
          const data = fs.readFileSync(resolve(process.cwd(), packPath));
          const h = createHash('sha256').update(data).digest('hex');
          packSha256 = h;
          const stat = fs.statSync(resolve(process.cwd(), packPath));
          packTs = new Date(stat.mtimeMs).toISOString().replace(/\..+$/, 'Z');
        } catch {}
      }
      const perfLines = [];
      const s = (slos && typeof slos === 'object') ? slos : {};
      const b = (benchObj && typeof benchObj === 'object') ? benchObj : {};
      if (typeof s.engine_get_p95_ms === 'number') perfLines.push(`- engine_get_p95_ms: ${s.engine_get_p95_ms}`);
      if (typeof s.engine_stream_ttff_p95_ms === 'number') perfLines.push(`- engine_stream_ttff_p95_ms: ${s.engine_stream_ttff_p95_ms}`);
      if (typeof b.p95_ms === 'number') perfLines.push(`- rollout_p95_ms: ${b.p95_ms} (T=${b?.meta?.T}, N=${b?.meta?.N})`);
      if (typeof loadObj.p95_ms === 'number') perfLines.push(`- load_p95_ms: ${loadObj.p95_ms} (N=${loadObj?.meta?.N})`);
      if (packPath) {
        const ts = packTs ? ` ts=${packTs}` : '';
        perfLines.push(`- pack: ${packPath} sha256=${packSha256}${ts}`);
      }
      // provenance from manifest if present
      try {
        const manifest = JSON.parse(fs.readFileSync(resolve(artifactDir, 'pack', 'manifest.json'), 'utf8'));
        const createdBy = manifest?.meta?.created_by;
        const verSha = manifest?.meta?.version_git_sha;
        const extra = [];
        if (createdBy) extra.push(`created_by=${createdBy}`);
        if (verSha) extra.push(`version_git_sha=${verSha}`);
        if (extra.length) perfLines.push(`- provenance: ${extra.join(' ')}`);
      } catch {}
      // Extract concise key gates
      const keyGate = (name) => (lines.find(l => l.includes(name)) || '').trim();
      const bullets = [
        keyGate('openapi lint'),
        keyGate('sdk:python smoke'),
        keyGate('stream chaos'),
        keyGate('ttff p95='),
        keyGate('runtime consistency'),
        keyGate('health enrich'),
        keyGate('stream rate limit'),
        keyGate('trust-proxy gate'),
        keyGate('load bench'),
        keyGate('provenance ok'),
        keyGate('provenance FAIL'),
      ].filter(Boolean);

      const summary = `\n## Performance\n` + perfLines.join('\n') + `\n\n- run_utc: ${new Date().toISOString()}\n\n## Key Gates\n` + bullets.map(b => `- ${b}`).join('\n') + `\n\n## All Gates\n` + lines.join('\n') + '\n';
      fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { encoding: 'utf8', flag: 'a' });
    } catch {}
  }
  const final = `GATES: ${failCount > 0 ? 'FAIL' : 'PASS'} — status card generated (passes=${passCount}, fails=${failCount})`;
  console.log(final);
  process.exit(failCount > 0 ? 1 : 0);
})();
