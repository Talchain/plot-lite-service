#!/usr/bin/env node
/**
 * Phase C: BMA determinism & stability metrics (10×)
 * Verify response hash and BMA hash stable across 10 runs
 */

import { computeBMA } from '../../lib/bma/beam.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const ENGINE_DIR = process.env.ENGINE_DIR || process.cwd();

const testGraph = {
  nodes: [{ id: 'price' }, { id: 'demand' }, { id: 'revenue' }],
  edges: [],
};

async function main() {
  console.log('GATES: Phase C — BMA determinism (10 runs)');

  const seed = 4242;
  const budget = 1000;
  const runs = 10;

  const bmaHashes = [];
  const respHashes = [];
  let lastResult;

  const runData = [];

  for (let i = 0; i < runs; i++) {
    const bmaResult = computeBMA(testGraph, seed, budget);

    const response = {
      schema: 'report.v1',
      meta: { seed },
      model_averaging: bmaResult,
    };

    const canonical = JSON.stringify(response, Object.keys(response).sort(), 2);
    const respHash = createHash('sha256').update(canonical, 'utf8').digest('hex');

    bmaHashes.push(bmaResult.bma_hash);
    respHashes.push(respHash);
    lastResult = bmaResult;

    runData.push({
      run: i + 1,
      bma_hash: bmaResult.bma_hash.slice(0, 16),
      resp_hash: respHash.slice(0, 16),
      K_evaluated: bmaResult.K_evaluated,
      K_used: bmaResult.K_used,
      mass_covered: bmaResult.mass_covered,
      action_consistency: bmaResult.action_consistency,
      sign_flip_rate: bmaResult.sign_flip_rate,
    });
  }

  // Verify all hashes match
  const firstBMA = bmaHashes[0];
  const firstResp = respHashes[0];

  for (let i = 1; i < runs; i++) {
    if (bmaHashes[i] !== firstBMA) {
      throw new Error(`BMA hash diverged on run ${i + 1}: ${bmaHashes[i].slice(0, 16)} !== ${firstBMA.slice(0, 16)}`);
    }
    if (respHashes[i] !== firstResp) {
      throw new Error(`Response hash diverged on run ${i + 1}: ${respHashes[i].slice(0, 16)} !== ${firstResp.slice(0, 16)}`);
    }
  }

  // Write JSONL log
  const jsonl = runData.map(r => JSON.stringify(r)).join('\n');
  writeFileSync(`${ENGINE_DIR}/reports/bma/bma_runs.jsonl`, jsonl, 'utf8');

  console.log(`GATES: PASS — BMA stable (resp_hash=${firstResp.slice(0, 8)}, bma_hash=${firstBMA.slice(0, 8)}, K=${lastResult.K_evaluated}, mass=${lastResult.mass_covered}, consistency=${lastResult.action_consistency}, sign_flip=${lastResult.sign_flip_rate})`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — bma-stability:', err.message);
  writeFileSync(`${ENGINE_DIR}/reports/diag/bma.json`, JSON.stringify({
    phase: 'bma',
    error: err.message,
    timestamp: new Date().toISOString(),
  }, null, 2), 'utf8');
  process.exit(1);
});
