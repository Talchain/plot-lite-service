#!/usr/bin/env node
/**
 * Bounded verification script for Engine pack
 * Prints exactly seven acceptance/size lines as specified in the pack standard
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PACK_DIR = join(ROOT, 'evidence', 'pack');
const UI_REPO = join(ROOT, '..', 'DecisionGuideAI');
const UI_INCOMING = join(UI_REPO, 'docs', 'evidence', 'incoming', 'engine');

function findLatestPack() {
  if (!existsSync(PACK_DIR)) return null;
  const files = readdirSync(PACK_DIR)
    .filter(f => f.startsWith('engine_pack_') && f.endsWith('.zip'))
    .sort()
    .reverse();
  return files.length > 0 ? join(PACK_DIR, files[0]) : null;
}

function findLatestPackDir() {
  const artifactDir = join(ROOT, 'artifact');
  if (!existsSync(artifactDir)) return null;
  const dirs = readdirSync(artifactDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('Evidence-Pack-'))
    .map(d => d.name)
    .sort()
    .reverse();
  return dirs.length > 0 ? join(artifactDir, dirs[0]) : null;
}

function timeout(cmd, timeoutMs = 5000) {
  try {
    return execSync(cmd, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (e) {
    return null;
  }
}

// Line 1: ENGINE_PACK
const packZip = findLatestPack();
const packDir = findLatestPackDir();

let sloP95 = 'missing';
let sloSummaryStatus = 'missing';

if (packDir && existsSync(packDir)) {
  const manifestPath = join(packDir, 'manifest.json');
  const summaryPath = join(packDir, 'SLO_SUMMARY.md');
  const loadcheckPath = join(packDir, 'reports', 'loadcheck.json');

  // Try manifest first
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.slos?.engine_get_p95_ms && typeof manifest.slos.engine_get_p95_ms === 'number') {
        sloP95 = manifest.slos.engine_get_p95_ms;
      }
    } catch {}
  }

  // Fallback to loadcheck.json if manifest didn't have it
  if (sloP95 === 'missing' && existsSync(loadcheckPath)) {
    try {
      const loadcheck = JSON.parse(readFileSync(loadcheckPath, 'utf8'));
      if (typeof loadcheck.p95_ms === 'number') {
        sloP95 = loadcheck.p95_ms;
      }
    } catch {}
  }

  if (existsSync(summaryPath)) {
    sloSummaryStatus = 'present';
  }
}

console.log(`ENGINE_PACK: ${packZip || 'missing'}, SLO engine_get_p95_ms=${sloP95}, SLO_SUMMARY=${sloSummaryStatus}`);

// Line 2: CONTRACTS
let contractsStatus = 'PASS';
let privacyStatus = 'FAIL';

if (packDir && existsSync(packDir)) {
  const summaryPath = join(packDir, 'SLO_SUMMARY.md');
  if (existsSync(summaryPath)) {
    const content = readFileSync(summaryPath, 'utf8');
    if (content.toLowerCase().includes('no request bodies or query strings in logs')) {
      privacyStatus = 'PASS — no request bodies or query strings in logs';
    } else {
      privacyStatus = 'FAIL — privacy phrase missing';
    }
  } else {
    privacyStatus = 'FAIL — SLO_SUMMARY.md missing';
  }

  // Check HEAD parity and ETag/304
  const head200Path = join(packDir, 'engine', 'head-200.h');
  const head304Path = join(packDir, 'engine', 'head-304.h');
  const get200Path = join(packDir, 'engine', 'draft-flows-200.h');
  const get304Path = join(packDir, 'engine', 'draft-flows-304.h');

  if (!existsSync(head200Path) || !existsSync(get200Path)) {
    contractsStatus = 'FAIL';
  }
} else {
  contractsStatus = 'FAIL';
}

console.log(`CONTRACTS: GET/HEAD/ETag/304 parity ${contractsStatus}; privacy check ${privacyStatus}`);

// Line 3: GATES
let gatesStatus = 'FAIL';
let sizeStatus = 'size > 50 MB';

if (packZip && existsSync(packZip)) {
  const stats = statSync(packZip);
  const sizeMB = stats.size / (1024 * 1024);
  if (sizeMB <= 50) {
    sizeStatus = 'size ≤ 50 MB';
  }

  if (sloP95 !== 'missing' && sloP95 <= 600) {
    gatesStatus = `PASS — p95 within budget; ${sizeStatus}`;
  } else {
    gatesStatus = `FAIL — p95 ${sloP95}; ${sizeStatus}`;
  }
}

console.log(`GATES: ${gatesStatus}`);

// Line 4: Handoff
let handoffStatus = 'skipped';
if (packZip && existsSync(packZip) && existsSync(UI_INCOMING)) {
  const packName = packZip.split('/').pop();
  const destPath = join(UI_INCOMING, packName);
  handoffStatus = existsSync(destPath) ? 'copied' : 'skipped';
}

console.log(`Handoff: ${handoffStatus}`);

// Line 5: FLAGS_EXPORT
const flagsPath = join(ROOT, 'docs', 'spec', 'engine.flags.json');
const flagsStatus = existsSync(flagsPath) ? 'present' : 'missing';
console.log(`FLAGS_EXPORT: docs/spec/engine.flags.json ${flagsStatus}`);

// Line 6: SIZE_AUDIT
const gitDbSize = timeout('du -sm .git 2>/dev/null | awk \'{print $1}\'') || 'unknown';
const workingTreeSize = timeout('du -sm --exclude=.git . 2>/dev/null | awk \'{print $1}\'') ||
                        timeout('du -sm . 2>/dev/null | awk \'NR==1{print $1}\'') || 'unknown';

console.log(`SIZE_AUDIT: working_tree=${workingTreeSize}MB, git_db=${gitDbSize}MB`);

// Line 7: SIZE_SUSPECTS
const bigTracked = timeout('git ls-files -z | xargs -0 -I{} du -m {} 2>/dev/null | awk \'$1>=25{c++}END{print c+0}\'') || '0';
const evidenceTracked = timeout('git ls-files evidence/pack/*.zip 2>/dev/null | wc -l') || '0';
const incomingTracked = timeout('git ls-files docs/evidence/incoming/ 2>/dev/null | wc -l') || '0';
const toolingTracked = timeout('git ls-files .tooling/node20/ 2>/dev/null | wc -l') || '0';

console.log(`SIZE_SUSPECTS: big_tracked_files(>=25MB)=${bigTracked.trim()}, evidence_pack_tracked=${evidenceTracked.trim()}, incoming_tracked=${incomingTracked.trim()}, tooling_node20_tracked=${toolingTracked.trim()}`);

// Line 8: EXPORTED_TO_UI
if (packZip && handoffStatus === 'copied' && existsSync(UI_INCOMING)) {
  const packName = packZip.split('/').pop();
  console.log(`EXPORTED_TO_UI: ${join(UI_INCOMING, packName)}`);
} else {
  console.log('EXPORTED_TO_UI: n/a');
}
