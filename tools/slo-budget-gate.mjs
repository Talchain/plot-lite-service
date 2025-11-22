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

  // Check engine_get_p95_ms
  if (typeof slos.engine_get_p95_ms === 'number') {
    const actual = slos.engine_get_p95_ms;
    const budget = BUDGETS.run_p95;
    const pass = actual <= budget;
    
    checks.push({
      name: 'engine_get_p95_ms',
      actual,
      budget,
      pass,
    });

    if (!pass) {
      violations.push(`engine_get_p95_ms: ${actual}ms > ${budget}ms budget`);
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
  const slos = loadSLOs();
  
  if (!slos) {
    console.log('GATES: FAIL — SLO data missing or insufficient (N=0)');
    process.exit(1);
  }

  const n = slos?.meta?.n ?? 0;
  if (typeof n !== 'number' || n < 50) {
    console.log(`GATES: FAIL — SLO data missing or insufficient (N=${n})`);
    process.exit(1);
  }

  const { checks, violations } = checkBudgets(slos);

  // Single-line GATES output only

  if (violations.length > 0) {
    const p95 = slos.engine_get_p95_ms;
    console.log(`GATES: FAIL — SLO breach (engine_get_p95_ms=${p95} > 600, N=${n})`);
    process.exit(1);
  }

  const p95 = slos.engine_get_p95_ms;
  console.log(`GATES: PASS — SLO budgets within limits (engine_get_p95_ms=${p95}, N=${n})`);
  process.exit(0);
}

// Run gate
runSLOBudgetGate().catch(err => {
  console.error('❌ SLO budget gate error:', err.message);
  console.log('GATES: FAIL — SLO budget gate error');
  process.exit(1);
});
