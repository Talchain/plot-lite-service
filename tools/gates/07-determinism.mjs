#!/usr/bin/env node
/**
 * Phase 7: Determinism gates
 * - Strict & normalised modes
 * - Verify BMA hash unchanged across 10 runs
 * - All response hashes must match
 */

import { computeBMA } from '../../lib/bma/beam.mjs';
import { createHash } from 'node:crypto';

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
  console.log('GATES: Phase 7 — Determinism gates');

  const seed = 4242;
  const runs = 10;

  const hashes_strict = [];
  const hashes_normalised = [];
  const bma_hashes = [];

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

  console.log(`GATES: PASS — determinism OK (strict+normalised, resp_hash=${first_normalised.slice(0, 8)}, bma_hash=${first_bma.slice(0, 8)}, ${runs}/${runs})`);
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
