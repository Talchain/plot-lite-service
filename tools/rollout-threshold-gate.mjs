#!/usr/bin/env node
/**
 * rollout-threshold-gate.mjs
 * Gate: ensure rollout bench p95_ms <= 30.
 * Emits exactly one GATES: line and non-zero exit on FAIL.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const p = resolve(process.cwd(), 'artifact', 'bench', 'rollout.json');
  let obj = null;
  try {
    obj = JSON.parse(readFileSync(p, 'utf8'));
  } catch {}
  if (!obj || typeof obj.p95_ms !== 'number') {
    console.log('GATES: FAIL — rollout bench missing');
    process.exit(1);
  }
  const p95 = obj.p95_ms;
  const limit = Number(process.env.ROLLOUT_P95_BUDGET_MS || 30);
  if (p95 <= limit) {
    console.log(`GATES: PASS — rollout p95 within budget (p95=${p95}ms ≤ ${limit}ms)`);
    process.exit(0);
  } else {
    console.log(`GATES: FAIL — rollout p95 too high (p95=${p95}ms > ${limit}ms)`);
    process.exit(1);
  }
} catch (e) {
  console.log('GATES: FAIL — rollout threshold gate error');
  process.exit(1);
}
