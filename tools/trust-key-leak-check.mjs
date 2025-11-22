#!/usr/bin/env node
/**
 * Check for private key leakage
 * Fails if private.pem appears outside out/keys/** or in any pack/zip
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';

try {
  // Check if private key exists
  if (!existsSync('out/keys/private.pem')) {
    console.log('GATES: PASS — no private key found (key leak check skipped)');
    process.exit(0);
  }

  // Search for private.pem outside out/keys
  let leaks = [];

  try {
    const result = execSync(
      'find . -name "private.pem" -not -path "./out/keys/*" -not -path "./node_modules/*" -not -path "./.git/*"',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    if (result.trim()) {
      leaks = result.trim().split('\n');
    }
  } catch (err) {
    // find returns non-zero if no matches, which is what we want
    if (err.status !== 0 && !err.stdout) {
      // Good - no matches
    } else if (err.stdout) {
      leaks = err.stdout.trim().split('\n').filter(Boolean);
    }
  }

  // Check for private key in packs/zips
  try {
    const zipResult = execSync(
      'find out -name "*.zip" -exec unzip -l {} \\; 2>/dev/null | grep -i "private.pem" || true',
      { encoding: 'utf8' }
    );
    if (zipResult.trim()) {
      leaks.push('private.pem found in zip archive');
    }
  } catch (err) {
    // Ignore errors from grep not finding matches
  }

  if (leaks.length > 0) {
    console.log(`GATES: FAIL — private key leak detected:`);
    leaks.forEach(leak => console.log(`  - ${leak}`));
    process.exit(1);
  }

  console.log('GATES: PASS — no private key leakage detected');
} catch (err) {
  console.log(`GATES: FAIL — key leak check error: ${err.message}`);
  process.exit(1);
}
