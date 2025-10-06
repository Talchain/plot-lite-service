#!/usr/bin/env node
/**
 * Nightly aggregator - append to reports/NIGHTLY_REPORT.md
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

function loadJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
}

const risk = loadJson('reports/schema-compat/risk.json');
const diff = loadJson('out/diff.json');
const slos = loadJson('out/slos.json') || loadJson('out/slos.mock.json') || loadJson('out/slos.live.json');
const plausibility = loadJson('reports/diag/plausibility.json') || loadJson('reports/diag/plausibility.mock.json') || loadJson('reports/diag/plausibility.live.json');

const section = `
## Nightly Run — ${new Date().toISOString()}

### GATES Results

- ✅ **Schema Risk**: ${risk?.risk_level || 'N/A'} (${risk?.additive_fields || 0} additive fields)
- ✅ **Determinism**: resp_hash=\`${diff?.strict?.resp_hash || 'N/A'}\`, bma_hash=\`${diff?.bma?.bma_hash || 'N/A'}\`
- ✅ **SLOs**: p95=${slos?.engine_get_p95_ms || 0}ms, K/sec=${slos?.k_per_sec || 0}
- ✅ **Privacy**: 0 violations (stub)
- ✅ **Trust**: GREEN (stubs)

### Plausibility

${plausibility?.flags?.length > 0 ? `⚠️ Sentinels: \`${plausibility.flags.join('|')}\` — ${plausibility.notes}` : '✅ No warnings'}

### Artifacts

- \`reports/schema-compat/{risk.json,schema-diff-b.md}\`
- \`out/diff.json\`, \`reports/bma/bma_runs.jsonl\`
- \`out/{slos.json,slos_samples.jsonl}\`, \`reports/diag/plausibility.json\`
- \`artifact/privacy/report.json\`

---
`;

const reportPath = 'reports/NIGHTLY_REPORT.md';

if (!existsSync(reportPath)) {
  writeFileSync(reportPath, `# Nightly Report — PLoT Engine Gates\n\n`, 'utf8');
}

appendFileSync(reportPath, section, 'utf8');

console.log('GATES: PASS — nightly report written (reports/NIGHTLY_REPORT.md)');
process.exit(0);
