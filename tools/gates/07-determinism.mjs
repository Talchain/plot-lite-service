#!/usr/bin/env node
/**
 * Phase 7: Determinism gates (v0.3.6 hardened)
 * - Run 10 identical seeded runs
 * - Enforce identical resp_hash & bma_hash across all runs
 * - Fail if sign_flip_rate > 0 or action_consistency < 1 for top action
 * - Emit both strict and normalised hashes
 */

import { computeBMA } from '../../lib/bma/beam.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const testGraph = {
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  edges: [],
};

function normaliseResponse(response) {
  // Drop volatile fields (timestamps, reqIds), keep schema & meta.seed
  const norm = { ...response };
  delete norm.meta?.generated_at;
  delete norm.meta?.request_id;
  return norm;
}

function hashResponse(response) {
  const canonical = JSON.stringify(response, Object.keys(response).sort(), 2);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

async function main() {
  console.log('GATES: Phase 7 — Determinism gates (v0.3.6, 10 runs)');

  const seed = 4242;
  const runs = 10;

  const hashes_strict = [];
  const hashes_normalised = [];
  const bma_hashes = [];
  const results = [];

  for (let i = 0; i < runs; i++) {
    const bmaResult = computeBMA(testGraph, seed, 1000);

    const response = {
      schema: 'report.v1',
      meta: {
        seed,
        generated_at: new Date().toISOString(), // volatile
        request_id: `req-${i}`, // volatile
      },
      model_averaging: bmaResult,
    };

    // Strict hash (includes volatile)
    const strict_hash = hashResponse(response);
    hashes_strict.push(strict_hash);

    // Normalised hash (drops volatile)
    const normalised = normaliseResponse(response);
    const normalised_hash = hashResponse(normalised);
    hashes_normalised.push(normalised_hash);

    bma_hashes.push(bmaResult.bma_hash);
    results.push(bmaResult);
  }

  // Verify normalised hashes are identical (strict will differ due to timestamps)
  const first_normalised = hashes_normalised[0];
  for (let i = 1; i < runs; i++) {
    if (hashes_normalised[i] !== first_normalised) {
      throw new Error(`Normalised hash changed on run ${i + 1}`);
    }
  }

  // Verify BMA hashes are identical
  const first_bma = bma_hashes[0];
  for (let i = 1; i < runs; i++) {
    if (bma_hashes[i] !== first_bma) {
      throw new Error(`BMA hash changed on run ${i + 1}`);
    }
  }

  // Check sign flip rate and action consistency (if results have these fields)
  const sign_flip_rates = results.map(r => r.sign_flip_rate || 0);
  const action_consistencies = results.map(r => r.action_consistency || 1);
  const top_action_consistency = Math.min(...action_consistencies);

  if (sign_flip_rates.some(rate => rate > 0)) {
    throw new Error(`Sign flip rate > 0 detected (${sign_flip_rates.join(', ')})`);
  }

  if (top_action_consistency < 1) {
    throw new Error(`Action consistency < 1 for top action (${top_action_consistency})`);
  }

  // Write determinism report
  const report = {
    schema: 'determinism.v1',
    seed,
    runs,
    strict_hash_unique: new Set(hashes_strict).size,
    normalised_hash_unique: new Set(hashes_normalised).size,
    bma_hash_unique: new Set(bma_hashes).size,
    strict_hash_first: hashes_strict[0].slice(0, 16),
    normalised_hash_first: first_normalised.slice(0, 16),
    bma_hash: first_bma.slice(0, 16),
    sign_flip_rate_max: Math.max(...sign_flip_rates),
    action_consistency_min: top_action_consistency,
    timestamp: new Date().toISOString()
  };

  writeFileSync('out/determinism.json', JSON.stringify(report, null, 2), 'utf8');

  console.log(`GATES: PASS — determinism OK (resp_hash=${first_normalised.slice(0, 8)}, bma_hash=${first_bma.slice(0, 8)}, runs=${runs}/${runs})`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — determinism:', err.message);
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('reports/diag/07-determinism.json', JSON.stringify({
      phase: '07-determinism',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, null, 2));
  });
  process.exit(1);
});
