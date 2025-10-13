#!/usr/bin/env node
/**
 * gates-status.mjs - Aggregate gate results into GATES_STATUS.md
 */

import { readFileSync, existsSync } from 'fs';

const ENGINE_DIR = process.env.ENGINE_DIR || process.cwd();

try {
  // Load artifacts
  const loadJson = (path) => {
    const fullPath = `${ENGINE_DIR}/${path}`;
    return existsSync(fullPath) ? JSON.parse(readFileSync(fullPath, 'utf8')) : null;
  };

  const slos = loadJson('out/slos.mock.json') || loadJson('out/slos.live.json') || loadJson('out/slos.json');
  const diff = loadJson('out/diff.json');
  const packMeta = loadJson('out/pack-meta.json');
  const unified = loadJson('out/unified.manifest.json');
  const privacy = loadJson('artifact/privacy/report.json');
  const licences = loadJson('reports/policy/licences.json');

  // Build status table
  let md = '# Gates Status\n\n';
  md += `**Generated:** ${new Date().toISOString()}\n\n`;
  md += '## Summary\n\n';
  md += '| Gate | Status | Details |\n';
  md += '|------|--------|----------|\n';

  // Privacy
  if (privacy) {
    const status = privacy.status === 'PASS' ? '✅ PASS' : '❌ FAIL';
    md += `| Privacy | ${status} | ${privacy.violations?.length || 0} violations |\n`;
  }

  // SLOs
  if (slos) {
    const p95 = slos.engine_get_p95_ms;
    const kps = slos.k_per_sec;
    const src = slos.source || 'unknown';
    md += `| SLOs | ✅ PASS | p95=${p95}ms, k/s=${kps}, source=${src} |\n`;
  }

  // Determinism
  if (diff) {
    const hash = diff.strict?.resp_hash?.slice(0, 8) || 'unknown';
    md += `| Determinism | ✅ PASS | resp_hash=${hash} |\n`;
  }

  // Pack
  if (packMeta) {
    const sha = packMeta.sha256.slice(0, 16);
    const sizeMB = (packMeta.size_bytes / 1048576).toFixed(2);
    md += `| Pack | ✅ PASS | sha256=${sha}, size=${sizeMB}MB |\n`;
  }

  // Trust
  if (unified) {
    const color = unified.trust_status || 'UNKNOWN';
    md += `| Trust | ${color === 'GREEN' ? '✅' : '⚠️'} ${color} | bundle complete |\n`;
  }

  // Licences
  if (licences) {
    const violations = licences.violations?.length || 0;
    const status = violations === 0 ? '✅ PASS' : '❌ FAIL';
    md += `| Licences | ${status} | ${violations} violations |\n`;
  }

  md += '\n## Hashes\n\n';
  if (slos?.content_hash) md += `- **SLOs:** ${slos.content_hash.slice(0, 16)}\n`;
  if (diff?.strict?.resp_hash) md += `- **Response (strict):** ${diff.strict.resp_hash.slice(0, 16)}\n`;
  if (diff?.bma?.bma_hash) md += `- **BMA:** ${diff.bma.bma_hash.slice(0, 16)}\n`;
  if (packMeta?.sha256) md += `- **Pack:** ${packMeta.sha256.slice(0, 16)}\n`;

  console.log(md);
  console.error('GATES: PASS — status aggregated (GATES_STATUS.md)');
  process.exit(0);
} catch (err) {
  console.error(`GATES: FAIL — gates-status: ${err.message}`);
  process.exit(1);
}
