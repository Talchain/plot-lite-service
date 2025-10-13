#!/usr/bin/env node
/**
 * Audit SBOM licences against allowlist
 * Usage: node tools/trust-audit.mjs [--out <licences.json>]
 * Environment: ALLOW_NOASSERTION=1 to permit NOASSERTION licences
 */

import { readFileSync, writeFileSync } from 'fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const auditPath = outIdx >= 0 ? args[outIdx + 1] : 'reports/policy/licences.json';

const ALLOW_NOASSERTION = process.env.ALLOW_NOASSERTION === '1';
const ALLOWED = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0'];

// Only add NOASSERTION if explicitly allowed
if (ALLOW_NOASSERTION) {
  ALLOWED.push('NOASSERTION');
}

// Read SBOM
const sbom = JSON.parse(readFileSync('out/sbom.spdx.json', 'utf8'));
const violations = [];

for (const pkg of sbom.packages) {
  if (!ALLOWED.includes(pkg.licenseConcluded)) {
    violations.push({
      package: pkg.name,
      licence: pkg.licenseConcluded,
      allowed: ALLOWED
    });
  }
}

const audit = {
  schema: 'licence-audit.v1',
  timestamp: new Date().toISOString(),
  allowed: ALLOWED,
  packages_checked: sbom.packages.length,
  violations
};

writeFileSync(auditPath, JSON.stringify(audit, null, 2));

if (violations.length > 0) {
  console.log(`GATES: FAIL — licence violations (count=${violations.length})`);
  process.exit(1);
}

console.log(`GATES: PASS — licence audit OK (packages=${sbom.packages.length}, violations=0)`);
