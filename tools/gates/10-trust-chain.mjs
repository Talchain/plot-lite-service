#!/usr/bin/env node
/**
 * Phase 10: Trust chain & policy (v0.3.6 hardened)
 * - Real Ed25519 signatures
 * - NOASSERTION blocked by default (only with ALLOW_NOASSERTION=1)
 * - Private key leak detection
 * - Key fingerprint surfaced
 * - Bundle completeness check
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

async function main() {
  console.log('GATES: Phase 10 — Trust chain & policy (v0.3.6)');

  mkdirSync('reports/policy', { recursive: true });

  try {
    // 1. Generate keys if needed
    execSync('node tools/trust-keygen.mjs --out out/keys', { stdio: 'inherit' });

    // 2. Sign pack
    execSync('node tools/trust-sign.mjs --out out/signatures.json', { stdio: 'inherit' });

    // 3. Generate SBOM
    execSync('node tools/trust-sbom.mjs --out out/sbom.spdx.json', { stdio: 'inherit' });

    // 4. Audit licences (NOASSERTION blocked unless ALLOW_NOASSERTION=1)
    execSync('node tools/trust-audit.mjs --out reports/policy/licences.json', { stdio: 'inherit' });

    // 5. Check for key leakage
    execSync('node tools/trust-key-leak-check.mjs', { stdio: 'inherit' });

    // 6. Create bundle with completeness check
    execSync('node tools/trust-bundle.mjs --out out/trust.bundle.json', { stdio: 'inherit' });

    // 7. Verify signatures and licences
    execSync('node tools/trust-verify.mjs out', { stdio: 'inherit' });

    console.log('GATES: PASS — trust chain complete (Ed25519, no leaks, complete bundle)');
    process.exit(0);
  } catch (err) {
    console.error(`GATES: FAIL — trust-chain: ${err.message}`);
    writeFileSync('reports/diag/10-trust-chain.json', JSON.stringify({
      phase: '10-trust-chain',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, null, 2));
    process.exit(1);
  }
}

main();
