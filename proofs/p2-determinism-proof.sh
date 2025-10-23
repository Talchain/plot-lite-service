#!/bin/bash
set -euo pipefail

echo "==> P2: Determinism Stamp (JCS Hash) — 5× Proof"
echo

echo "Running 5 identical requests with different volatile fields..."
echo

# Run the determinism test
npx vitest run tests/p2-determinism.unit.test.ts 2>&1 | grep -A5 "5× determinism proof"

echo
echo "Expected: Single unique hash across all 5 runs"
echo "Volatile fields excluded: trace_id, meta.response_id, meta.elapsed_ms"
echo

# Demonstrate with Node
node <<'NODEEOF'
const { stampResponseHash } = require('./dist/lib/jcs-hash.js');

const template = { template: 'test', seed: 4242, result: { value: 100 } };
const hashes = [];

console.log('Running 5 iterations:\n');

for (let i = 0; i < 5; i++) {
  const payload = {
    ...template,
    trace_id: `trace-${i}`,
    meta: { seed: 4242, response_id: `uuid-${i}`, elapsed_ms: 100 + i }
  };
  const { response_hash } = stampResponseHash(payload);
  hashes.push(response_hash);
  console.log(`  Run ${i + 1}: ${response_hash.slice(0, 16)}...`);
}

const uniqueHashes = new Set(hashes);
console.log(`\n✅ Unique hashes: ${uniqueHashes.size} (expected: 1)`);
console.log(`✅ Full hash: ${hashes[0]}`);
NODEEOF

echo
echo "==> P2 Proof complete"
