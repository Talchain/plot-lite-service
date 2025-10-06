#!/usr/bin/env node
/**
 * SLO Budget Gate (Track D)
 * 
 * Verifies performance budgets for Engine endpoints:
 * - /v1/run p95 ≤ 600ms
 * - TTFF (Time To First Frame) ≤ 500ms (SSE)
 * - Cancel latency ≤ 150ms
 * 
 * Exit 0 = PASS (within budgets)
 * Exit 1 = FAIL (budget breached)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// SLO Budget definitions (in milliseconds)
const BUDGETS = {
  run_p95: 600,
  ttff: 500,
  cancel: 150,
};

/**
 * Load SLO measurements from slos.json if available
 */
function loadSLOs() {
  const sloPath = resolve(projectRoot, 'artifact', 'slos.json');
  
  if (!existsSync(sloPath)) {
    console.log('⏭️  No slos.json found - skipping budget check');
    console.log('   (Run performance harness first: npm run perf:slos)');
    return null;
  }

  try {
    return JSON.parse(readFileSync(sloPath, 'utf8'));
  } catch (err) {
    console.error('❌ Failed to parse slos.json:', err.message);
    return null;
  }
}

/**
 * Check if SLOs meet budgets
 */
function checkBudgets(slos) {
  const violations = [];
  const checks = [];

  // Check /v1/run p95
  if (slos.endpoints?.run?.p95_ms !== undefined) {
    const actual = slos.endpoints.run.p95_ms;
    const budget = BUDGETS.run_p95;
    const pass = actual <= budget;
    
    checks.push({
      name: '/v1/run p95',
      actual,
      budget,
      pass,
    });

    if (!pass) {
      violations.push(`/v1/run p95: ${actual}ms > ${budget}ms budget`);
    }
  }

  // Check TTFF
  if (slos.sse?.ttff_p95_ms !== undefined) {
    const actual = slos.sse.ttff_p95_ms;
    const budget = BUDGETS.ttff;
    const pass = actual <= budget;
    
    checks.push({
      name: 'SSE TTFF p95',
      actual,
      budget,
      pass,
    });

    if (!pass) {
      violations.push(`SSE TTFF p95: ${actual}ms > ${budget}ms budget`);
    }
  }

  // Check Cancel latency
  if (slos.sse?.cancel_p95_ms !== undefined) {
    const actual = slos.sse.cancel_p95_ms;
    const budget = BUDGETS.cancel;
    const pass = actual <= budget;
    
    checks.push({
      name: 'SSE Cancel p95',
      actual,
      budget,
      pass,
    });

    if (!pass) {
      violations.push(`SSE Cancel p95: ${actual}ms > ${budget}ms budget`);
    }
  }

  return { checks, violations };
}

/**
 * Main gate logic
 */
async function runSLOBudgetGate() {
  console.log('🔍 Checking SLO budgets...\n');

  const slos = loadSLOs();
  
  if (!slos) {
    console.log('GATES: PASS — SLO budgets within limits (no measurements)');
    process.exit(0);
  }

  const { checks, violations } = checkBudgets(slos);

  // Print results
  if (checks.length === 0) {
    console.log('⏭️  No SLO metrics found in slos.json');
    console.log('GATES: PASS — SLO budgets within limits (no metrics)');
    process.exit(0);
  }

  for (const check of checks) {
    const icon = check.pass ? '✅' : '❌';
    const status = check.pass ? 'PASS' : 'FAIL';
    console.log(`${icon} ${check.name}: ${check.actual.toFixed(2)}ms / ${check.budget}ms — ${status}`);
  }

  console.log('');

  if (violations.length > 0) {
    console.log('❌ Budget violations:');
    for (const violation of violations) {
      console.log(`   - ${violation}`);
    }
    console.log('');
    console.log('GATES: FAIL — SLO budget breached');
    process.exit(1);
  }

  console.log('GATES: PASS — SLO budgets within limits');
  process.exit(0);
}

// Run gate
runSLOBudgetGate().catch(err => {
  console.error('❌ SLO budget gate error:', err.message);
  console.log('GATES: FAIL — SLO budget gate error');
  process.exit(1);
});
