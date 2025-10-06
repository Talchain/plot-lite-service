#!/usr/bin/env node
/**
 * Phase 4: Model averaging (seeded beam, BMA hash)
 * - Seeded beam search with sparse prior p_edge≈0.1
 * - Fixed CPDAG→DAG tie-break
 * - Compute: K_evaluated, K_used, mass_covered, BMA hash
 * - Metrics: action_consistency, sign_flip_rate
 */

import { computeBMA } from '../../lib/bma/beam.mjs';
import { createHash } from 'node:crypto';

const testGraph = {
  nodes: [
    { id: 'price' },
    { id: 'demand' },
    { id: 'revenue' },
  ],
  edges: [],
};

async function main() {
  console.log('GATES: Phase 4 — Model averaging');

  const seed = 4242;
  const budget = 1000;

  // Run BMA 10 times with same seed → must get identical hash
  const hashes = [];
  let lastResult;

  for (let i = 0; i < 10; i++) {
    const result = computeBMA(testGraph, seed, budget);
    hashes.push(result.bma_hash);
    lastResult = result;

    if (i > 0 && result.bma_hash !== hashes[0]) {
      throw new Error(`BMA hash changed on run ${i + 1}: ${result.bma_hash} !== ${hashes[0]}`);
    }
  }

  // Compute response hash (includes BMA result)
  const response = {
    schema: 'report.v1',
    meta: { seed },
    model_averaging: lastResult,
  };

  const canonical = JSON.stringify(response, Object.keys(response).sort(), 2);
  const resp_hash = createHash('sha256').update(canonical, 'utf8').digest('hex');

  // Validate metrics
  if (lastResult.K_evaluated !== budget) {
    throw new Error(`K_evaluated mismatch: ${lastResult.K_evaluated} !== ${budget}`);
  }

  if (lastResult.mass_covered < 0 || lastResult.mass_covered > 1) {
    throw new Error(`mass_covered out of range: ${lastResult.mass_covered}`);
  }

  console.log(`GATES: PASS — BMA stable (resp_hash=${resp_hash.slice(0, 8)}, bma_hash=${lastResult.bma_hash.slice(0, 8)}, K=${lastResult.K_evaluated}, mass=${lastResult.mass_covered})`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — model-averaging:', err.message);
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('reports/diag/04-model-averaging.json', JSON.stringify({
      phase: '04-model-averaging',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, null, 2));
  });
  process.exit(1);
});
