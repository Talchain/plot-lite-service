#!/usr/bin/env node
/**
 * Generate SBOM in SPDX 2.3 format
 * Usage: node tools/trust-sbom.mjs [--out <sbom.spdx.json>]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const sbomPath = outIdx >= 0 ? args[outIdx + 1] : 'out/sbom.spdx.json';

// Read package.json
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

function getLicenceFromPackage(pkgName) {
  const possiblePaths = [
    `node_modules/${pkgName}/package.json`,
    `../node_modules/${pkgName}/package.json`
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        const pkgJson = JSON.parse(readFileSync(path, 'utf8'));
        return pkgJson.license || pkgJson.licence || 'NOASSERTION';
      } catch (err) {
        // Continue to next path
      }
    }
  }
  return 'NOASSERTION';
}

const packages = Object.entries(deps).map(([name, version]) => {
  const licence = getLicenceFromPackage(name);
  return {
    SPDXID: `SPDXRef-${name.replace(/[@/]/g, '-')}`,
    name,
    versionInfo: version,
    licenseConcluded: licence,
    supplier: 'Organization: npm'
  };
});

const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'plot-lite-service-sbom',
  documentNamespace: 'https://github.com/Talchain/plot-lite-service/sbom',
  creationInfo: {
    created: new Date().toISOString(),
    creators: ['Tool: trust-sbom']
  },
  packages
};

writeFileSync(sbomPath, JSON.stringify(sbom, null, 2));
console.log(`GATES: PASS — sbom generated (SPDX 2.3, packages=${packages.length})`);
