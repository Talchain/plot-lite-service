#!/usr/bin/env node
/**
 * Verify Ed25519 signatures and licence audit
 * Usage: node tools/trust-verify.mjs [out-dir]
 */

import { createHash, verify } from 'crypto';
import { readFileSync, existsSync } from 'fs';

const outDir = process.argv[2] || 'out';

try {
  // Load artifacts
  const signatures = JSON.parse(readFileSync(`${outDir}/signatures.json`, 'utf8'));
  const packPath = `${outDir}/${signatures.pack.filename}`;
  const licenceAudit = JSON.parse(readFileSync('reports/policy/licences.json', 'utf8'));

  // Verify pack exists
  if (!existsSync(packPath)) {
    console.log(`GATES: FAIL — pack file not found: ${packPath}`);
    process.exit(1);
  }

  // Verify Ed25519 signature
  const packBytes = readFileSync(packPath);
  const packHash = createHash('sha256').update(packBytes).digest('hex');

  if (packHash !== signatures.pack.sha256) {
    console.log('GATES: FAIL — pack hash mismatch');
    process.exit(1);
  }

  const publicKeyPem = signatures.public_key_pem;
  const signatureBuffer = Buffer.from(signatures.pack.signature_b64, 'base64');

  const isValid = verify(null, packBytes, publicKeyPem, signatureBuffer);

  if (!isValid) {
    console.log('GATES: FAIL — Ed25519 signature verification failed');
    process.exit(1);
  }

  // Check licence audit
  if (licenceAudit.violations.length > 0) {
    console.log(`GATES: FAIL — licence violations (count=${licenceAudit.violations.length})`);
    process.exit(1);
  }

  const keyFpr = signatures.key_fpr || 'N/A';
  const signatureStatus = isValid ? 'GREEN' : 'RED';
  const licenceStatus = licenceAudit.violations.length === 0 ? 'OK' : 'FAIL';

  console.log(`GATES: PASS — trust verified (signatures ${signatureStatus}, licences ${licenceStatus}, key_fpr=${keyFpr})`);
} catch (err) {
  console.log(`GATES: FAIL — trust-verify error: ${err.message}`);
  process.exit(1);
}
