#!/usr/bin/env node
/**
 * Self-Check Hash Stability Gate
 * 
 * Calls /v1/self-check 10 times and verifies identical hash across all calls.
 * Ensures deterministic behaviour of end-to-end /v1/run code path.
 */

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4311';
const CYCLES = 10;

async function main() {
  const hashes = [];
  const bytes = [];

  for (let i = 0; i < CYCLES; i++) {
    try {
      const res = await fetch(`${BASE}/v1/self-check`);
      
      if (!res.ok) {
        console.error(`❌ Self-check returned ${res.status}`);
        console.error('GATES: FAIL — self-check endpoint unavailable or errored');
        process.exit(1);
      }

      const data = await res.json();
      
      if (!data.hash || typeof data.hash !== 'string') {
        console.error('❌ Self-check response missing hash field');
        console.error('GATES: FAIL — self-check response malformed');
        process.exit(1);
      }

      hashes.push(data.hash);
      bytes.push(data.bytes);
    } catch (err) {
      console.error(`❌ Failed to call self-check: ${err.message}`);
      console.error('GATES: FAIL — self-check endpoint unreachable');
      process.exit(1);
    }
  }

  // Check all hashes are identical
  const uniqueHashes = new Set(hashes);
  if (uniqueHashes.size !== 1) {
    console.error(`❌ Hash drift detected across ${CYCLES} runs`);
    console.error(`   Unique hashes: ${uniqueHashes.size}`);
    console.error(`   Hashes: ${Array.from(uniqueHashes).join(', ')}`);
    console.error(`GATES: FAIL — self-check hash drift detected (hashes: ${Array.from(uniqueHashes).join(', ')})`);
    process.exit(1);
  }

  // Check all byte counts are identical
  const uniqueBytes = new Set(bytes);
  if (uniqueBytes.size !== 1) {
    console.error(`❌ Byte count drift detected across ${CYCLES} runs`);
    console.error(`   Unique byte counts: ${uniqueBytes.size}`);
    console.error(`GATES: FAIL — self-check byte count drift detected`);
    process.exit(1);
  }

  console.log(`✅ Self-check hash stable across ${CYCLES} runs`);
  console.log(`   Hash: ${hashes[0]}`);
  console.log(`   Bytes: ${bytes[0]}`);
  console.log(`GATES: PASS — self-check hash stable across ${CYCLES} runs`);
  process.exit(0);
}

main().catch(err => {
  console.error(`❌ Unexpected error: ${err.message}`);
  console.error('GATES: FAIL — self-check gate crashed');
  process.exit(1);
});
