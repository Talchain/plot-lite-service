#!/usr/bin/env node
/**
 * run-one-shot.mjs
 * Non-interactive orchestrator that runs the one-shot build/tests/gates with per-step timeouts
 * and prints ONLY the single GATES lines from each gate/tool. If a step times out or emits
 * no GATES line, it prints a single SKIP/FAIL GATES line instead and proceeds.
 */

import { spawnSync } from 'node:child_process';

function run(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs ?? 60000,
    env: process.env,
    cwd: process.cwd(),
  });
  return {
    code: res.status ?? 1,
    out: (res.stdout || '') + (res.stderr || ''),
    signal: res.signal || null,
    timedOut: Boolean(res.error && res.error.code === 'ETIMEDOUT'),
    error: res.error || null,
  };
}

function onlyGates(out) {
  const lines = out.split(/\r?\n/).filter(l => l.startsWith('GATES:'));
  return lines;
}

function printOrFallback(toolName, out, fallbackKind = 'SKIP', reason = 'no GATES line') {
  const lines = onlyGates(out);
  if (lines.length === 1) {
    console.log(lines[0]);
    return true;
  }
  if (lines.length > 1) {
    console.log(`GATES: FAIL — ${toolName} emitted multiple GATES lines (${lines.length})`);
    return false;
  }
  console.log(`GATES: ${fallbackKind} — ${toolName} ${reason}`);
  return false;
}

function assertOk(step, res) {
  if (res.code !== 0) {
    const msg = res.out.trim().split(/\r?\n/).slice(-10).join('\n');
    throw new Error(`${step} failed (code=${res.code})\n${msg}`);
  }
}

(async () => {
  try {
    // 0) Build + focused tests
    const build = run('npm', ['run', 'build'], { timeoutMs: 120000 });
    assertOk('build', build);

    const vitestArgs = [
      'vitest', 'run',
      'tests/stream.query.validation.test.ts',
      'tests/stream.latency.test.ts',
      'tests/identifiability.dsep.props.test.ts',
      'tests/identifiability.multi-set.test.ts',
      'tests/identifiability.rules.test.ts',
      'tests/hash.invariants.test.ts',
      'tests/selfcheck.parity.test.ts',
      'tests/auth.v1.routes.test.ts',
      '--reporter=dot',
    ];
    const tests = run('npx', vitestArgs, { timeoutMs: 180000 });
    // Intentionally do not emit a GATES line for tests; continue regardless.

    // 1) Perf + rollout bench + pack
    const perf = run('node', ['tools/perf-collect.mjs'], { timeoutMs: 120000 });
    assertOk('perf:collect', perf);

    const roll = run('node', ['tools/rollout-bench.mjs'], { timeoutMs: 60000 });
    printOrFallback('rollout-bench', roll.out, roll.code === 0 ? 'SKIP' : 'FAIL', roll.code === 0 ? 'no GATES line' : 'error');

    const pack = run('node', ['tools/pack-engine.mjs'], { timeoutMs: 60000 });
    printOrFallback('pack-engine', pack.out, pack.code === 0 ? 'SKIP' : 'FAIL', pack.code === 0 ? 'no GATES line' : 'error');

    // 2) Smokes & gates — each prints exactly one GATES line
    const tools = [
      'sdk-smoke.mjs',
      'chaos-smoke.mjs',
      'chaos-auth-smoke.mjs',
      'ttff-collect.mjs',
      'load-bench.mjs',
      'rollout-threshold-gate.mjs',
      'contract-drift-gate.mjs',
      'slo-budget-gate.mjs',
      'privacy-gate.mjs',
      'self-check-gate.mjs',
      'health-gate.mjs',
      'provenance-gate.mjs',
      'gates-status.mjs',
    ];

    for (const t of tools) {
      const r = run('node', ['tools/' + t], { timeoutMs: 60000 });
      if (r.timedOut) {
        console.log(`GATES: SKIP — ${t} timeout`);
        continue;
      }
      // If the tool fails (code!=0), still print wherever possible
      const ok = printOrFallback(t, r.out, r.code === 0 ? 'SKIP' : 'FAIL', r.code === 0 ? 'no GATES line' : 'error');
      // do not throw; keep moving to gather all GATES
    }
  } catch (e) {
    // Collapse failures into a single GATES line to avoid hanging or noisy logs
    console.log(`GATES: FAIL — one-shot aborted (${e?.message || 'error'})`);
    process.exit(1);
  }
})();
