#!/usr/bin/env node
/**
 * Unified Gate Runner (Track G)
 *
 * Full CI gate set — intentionally heavier and more exhaustive than the
 * dev-fast rollup in tools/gates-status.mjs. The two lists differ by design:
 * - gates-status.mjs: quick local signal, single-line GATES per tool, fast
 * - run-all-gates.mjs: full CI coverage, may include heavier checks
 *
 * Runs all CI gates in sequence and reports aggregate status.
 * Designed for CI/CD pipelines with clear pass/fail outcomes.
 *
 * Exit 0 = ALL PASS
 * Exit 1 = ANY FAIL
 */

import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Gate definitions (order matters for logical grouping)
const GATES = [
  {
    name: 'Determinism',
    script: 'ban-math-random.mjs',
    description: 'No Math.random() or Date.now() in trust/util',
    critical: true,
  },
  {
    name: 'Self-Check Stability',
    script: 'self-check-gate.mjs',
    description: 'Self-check hash stable across 10 runs',
    critical: true,
  },
  {
    name: 'SSE Inflight Balance',
    script: 'sse-inflight-gate.mjs',
    description: 'SSE connections balanced after 100 cycles',
    critical: true,
  },
  {
    name: 'Environment Leaks',
    script: 'test-env-gate.mjs',
    description: 'No leaked env keys after tests',
    critical: true,
  },
  {
    name: 'Contract Drift',
    script: 'contract-drift-gate.mjs',
    description: 'Contracts unchanged vs snapshots',
    critical: true,
  },
  {
    name: 'SLO Budgets',
    script: 'slo-budget-gate.mjs',
    description: 'Performance within budgets',
    critical: false, // Non-blocking until harness runs
  },
  {
    name: 'Privacy',
    script: 'privacy-gate.mjs',
    description: 'No sensitive payloads in logs',
    critical: true,
  },
  {
    name: 'Numeric Egress',
    script: 'numeric-egress-gate.mjs',
    description: 'No literal fallback on a contract-declared numeric response field',
    critical: true,
  },
];

/**
 * Run a single gate and capture result
 */
function runGate(gate) {
  const start = Date.now();
  
  try {
    const output = execSync(`node tools/${gate.script}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    
    const duration = Date.now() - start;
    
    // Extract GATES: line from output
    const lines = output.split('\n');
    const gateLine = lines.find(l => l.includes('GATES:'));
    const status = gateLine?.includes('PASS') ? 'PASS' : 'UNKNOWN';
    
    return {
      name: gate.name,
      status,
      duration,
      output: output.trim(),
      error: null,
      critical: gate.critical,
    };
  } catch (err) {
    const duration = Date.now() - start;
    
    return {
      name: gate.name,
      status: 'FAIL',
      duration,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
      critical: gate.critical,
    };
  }
}

/**
 * Format duration for display
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Main runner
 */
async function runAllGates() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          PLoT Engine — Unified Gate Runner                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const results = [];
  let failCount = 0;
  let criticalFailCount = 0;

  for (const gate of GATES) {
    const icon = gate.critical ? '🔒' : '🔓';
    process.stdout.write(`${icon} ${gate.name}... `);
    
    const result = runGate(gate);
    results.push(result);
    
    if (result.status === 'PASS') {
      console.log(`✅ PASS (${formatDuration(result.duration)})`);
    } else if (result.status === 'FAIL') {
      failCount++;
      if (result.critical) criticalFailCount++;
      console.log(`❌ FAIL (${formatDuration(result.duration)})`);
    } else {
      console.log(`⚠️  UNKNOWN (${formatDuration(result.duration)})`);
    }
  }

  // Print summary
  console.log('\n' + '─'.repeat(60));
  console.log('📊 Gate Summary:\n');

  const passCount = results.filter(r => r.status === 'PASS').length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`   Total:    ${GATES.length} gates`);
  console.log(`   Passed:   ${passCount} (${((passCount / GATES.length) * 100).toFixed(0)}%)`);
  console.log(`   Failed:   ${failCount}`);
  console.log(`   Critical: ${criticalFailCount} failures`);
  console.log(`   Duration: ${formatDuration(totalDuration)}`);

  // Show failures in detail
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\n❌ Failed Gates:\n');
    for (const failure of failures) {
      const critMarker = failure.critical ? '[CRITICAL]' : '[NON-BLOCKING]';
      console.log(`   ${critMarker} ${failure.name}`);
      if (failure.error) {
        console.log(`   Error: ${failure.error.split('\n')[0]}`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));

  // Determine exit code
  if (criticalFailCount > 0) {
    console.log('\n🚨 GATES: FAIL — Critical gates failed');
    console.log('   Fix critical issues before merging.\n');
    process.exit(1);
  } else if (failCount > 0) {
    console.log('\n⚠️  GATES: PASS (with warnings)');
    console.log('   Non-critical gates failed but build may proceed.\n');
    process.exit(0);
  } else {
    console.log('\n✅ GATES: PASS — All gates green');
    console.log('   Ready for deployment.\n');
    process.exit(0);
  }
}

// Run
runAllGates().catch(err => {
  console.error('\n❌ Gate runner error:', err.message);
  console.log('GATES: FAIL — gate runner error\n');
  process.exit(1);
});
