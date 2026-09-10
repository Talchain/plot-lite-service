#!/usr/bin/env node
/**
 * overrides-effective-gate — fail loud when a security override stops protecting anything.
 *
 * WHY THIS EXISTS (2026-09-10). `package.json` `overrides` is a hand-maintained mirror of the
 * advisory landscape, and it fails SILENTLY in two directions. Both have now been observed:
 *
 *   1. STALE PIN (this repo, 2026-09-10). The entries read `"fast-uri@3": "3.1.4"` and
 *      `"fast-uri@4": "4.1.1"`. The selectors matched, the overrides applied perfectly, and the
 *      pinned versions were themselves inside the advisory range. An EXACT pin can never float
 *      forward when an advisory floor moves, so the override kept forcing a vulnerable version
 *      long after a patched one shipped. Nothing in the file looked wrong.
 *
 *   2. DECORATIVE SELECTOR (sibling repo DecisionGuideAI, PR #1440). The entry read
 *      `"fast-uri@<3.1.5": "^3.1.5"`. Once the advisory floor moved past 3.1.5 the SELECTOR
 *      stopped matching and the pin applied to nothing — while still sitting in the file,
 *      still reading as correct to anyone inspecting it.
 *
 * In both cases a reader sees a pin and concludes the dependency is protected. `npm audit` only
 * notices once an advisory happens to exist for whatever got resolved instead; it is silent about
 * an override that has quietly stopped applying. This gate closes that gap by DERIVING the answer
 * from npm's own resolution rather than re-implementing semver matching:
 *
 *   E1 EFFECT — every node in the resolved tree carrying an overridden package's name must be
 *               flagged `overridden: true` by npm itself. Zero matching nodes is also a failure:
 *               an override that governs nothing is dead weight pretending to be protection.
 *   E2 SHAPE  — the pin VALUE must be a floating range (^ ~ >=), never an exact version, so a
 *               patched release is absorbed on the next resolution instead of requiring a human
 *               to notice. This is the check that would have caught defect 1 at rest.
 *
 * `--self-test` runs discriminating positive controls in BOTH directions against synthetic trees,
 * and CI runs it before the real check. A guard that cannot demonstrate it still fails is not a
 * guard; this one proves its own discrimination on every run.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Split an override key into its package name. `fast-uri@3` -> `fast-uri`; `@scope/x@1` -> `@scope/x`. */
export function overrideKeyToName(key) {
  const at = key.lastIndexOf('@');
  if (at <= 0) return key; // bare name, or a leading-@ scope with no selector
  return key.slice(0, at);
}

/** Collect every node of a given package name from an `npm ls --all --json` tree. */
export function collectNodes(tree, name, out = [], seen = new Set()) {
  const deps = tree?.dependencies;
  if (!deps) return out;
  for (const [depName, node] of Object.entries(deps)) {
    if (!node || typeof node !== 'object') continue;
    if (depName === name) out.push(node);
    if (seen.has(node)) continue;
    seen.add(node);
    collectNodes(node, name, out, seen);
  }
  return out;
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

/** Pure check. Returns an array of failure strings; empty means pass. */
export function checkOverrides(overrides, tree) {
  const failures = [];
  for (const [key, pin] of Object.entries(overrides ?? {})) {
    const name = overrideKeyToName(key);

    // E2 SHAPE — an exact pin cannot absorb a patched release.
    if (typeof pin === 'string' && EXACT_VERSION.test(pin.trim())) {
      failures.push(
        `E2 SHAPE  "${key}": "${pin}" is an EXACT version. An exact pin cannot float forward when ` +
          `an advisory floor moves — it will keep forcing "${pin}" after a patched release ships. ` +
          `Use a floating range (e.g. "^${pin}").`,
      );
    }

    // E1 EFFECT — npm must report every resolved node of this name as overridden.
    const nodes = collectNodes(tree, name);
    if (nodes.length === 0) {
      failures.push(
        `E1 EFFECT "${key}": no node named "${name}" resolves in the tree. This override governs ` +
          `nothing — either the dependency is gone (delete the entry) or the selector no longer matches.`,
      );
      continue;
    }
    const notOverridden = nodes.filter((n) => n.overridden !== true);
    if (notOverridden.length > 0) {
      const versions = [...new Set(notOverridden.map((n) => n.version ?? '?'))].join(', ');
      failures.push(
        `E1 EFFECT "${key}": ${notOverridden.length} of ${nodes.length} resolved "${name}" node(s) ` +
          `are NOT marked overridden by npm (version(s): ${versions}). The selector "${key}" has ` +
          `stopped matching them, so the pin "${pin}" is decorative for those paths.`,
      );
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ self-test */

function selfTest() {
  const cases = [];
  const treeOK = {
    dependencies: {
      ajv: { version: '8.18.0', dependencies: { 'fast-uri': { version: '3.1.7', overridden: true } } },
    },
  };

  // Control 1 — a healthy override must PASS. (Proves the gate is not fail-always.)
  cases.push(['healthy override passes', checkOverrides({ 'fast-uri@3': '^3.1.6' }, treeOK).length === 0]);

  // Control 2 — DEFECT 1: an exact pin must RED on E2. (This repo's 2026-09-10 defect.)
  const exact = checkOverrides({ 'fast-uri@3': '3.1.4' }, treeOK);
  cases.push(['exact pin REDs on E2', exact.length === 1 && exact[0].startsWith('E2 SHAPE')]);

  // Control 3 — DEFECT 2: a selector npm did not apply must RED on E1. (The sibling repo's defect.)
  const treeNotOverridden = {
    dependencies: {
      ajv: { version: '8.18.0', dependencies: { 'fast-uri': { version: '3.1.5', overridden: false } } },
    },
  };
  const decorative = checkOverrides({ 'fast-uri@<3.1.5': '^3.1.5' }, treeNotOverridden);
  cases.push(['decorative selector REDs on E1', decorative.length === 1 && decorative[0].startsWith('E1 EFFECT')]);

  // Control 4 — an override governing nothing must RED on E1.
  const absent = checkOverrides({ 'gone-pkg@1': '^1.2.3' }, treeOK);
  cases.push(['override governing nothing REDs on E1', absent.length === 1 && absent[0].startsWith('E1 EFFECT')]);

  // Control 5 — the two checks are INDEPENDENT: an exact pin that also does not apply REDs twice,
  // on different codes. Proves E2 passing is not silently swallowing E1 (or vice versa).
  const both = checkOverrides({ 'fast-uri@3': '3.1.4' }, treeNotOverridden);
  cases.push([
    'exact + decorative REDs on BOTH codes',
    both.length === 2 && both.some((f) => f.startsWith('E2 SHAPE')) && both.some((f) => f.startsWith('E1 EFFECT')),
  ]);

  // Control 6 — scoped names must not be mis-split.
  cases.push(['scoped name parses', overrideKeyToName('@scope/pkg@^1.0.0') === '@scope/pkg']);

  let failed = 0;
  for (const [label, ok] of cases) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\noverrides-effective-gate SELF-TEST FAILED (${failed}/${cases.length}).`);
    console.error('The gate can no longer discriminate. Fix the gate before trusting any run of it.');
    process.exit(1);
  }
  console.log(`overrides-effective-gate self-test: ${cases.length}/${cases.length} controls pass.\n`);
}

/* ------------------------------------------------------------------ main */

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    console.log('overrides-effective-gate self-test (discriminating controls, both directions):');
    selfTest();
    if (args.length === 1) return;
  }

  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  const overrides = pkg.overrides ?? {};
  if (Object.keys(overrides).length === 0) {
    console.log('overrides-effective-gate: no overrides declared, nothing to check.');
    return;
  }

  // Derive the resolved tree from npm itself. `npm ls` exits non-zero on any tree quibble
  // (peer warnings, extraneous packages) while still emitting valid JSON, so read stdout and
  // judge the JSON — but treat unparseable output as a HARD ERROR, never as a pass.
  let raw;
  try {
    raw = execFileSync('npm', ['ls', '--all', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    raw = err.stdout;
  }
  if (!raw || !raw.trim()) {
    console.error('overrides-effective-gate: `npm ls --all --json` produced NO output. Cannot measure. Failing.');
    process.exit(1);
  }
  let tree;
  try {
    tree = JSON.parse(raw);
  } catch {
    console.error('overrides-effective-gate: `npm ls --all --json` output did not parse. Cannot measure. Failing.');
    process.exit(1);
  }
  if (!tree.dependencies || Object.keys(tree.dependencies).length === 0) {
    console.error('overrides-effective-gate: resolved tree has NO dependencies — node_modules is absent or empty.');
    console.error('Run `npm ci` first. An empty tree would make every check vacuous, so this is a hard error.');
    process.exit(1);
  }

  const failures = checkOverrides(overrides, tree);
  const names = Object.keys(overrides);
  if (failures.length > 0) {
    console.error(`\noverrides-effective-gate: FAIL — ${failures.length} problem(s) across ${names.length} override(s).\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    console.error('A security override that does not apply is worse than no override: it reads as protection.');
    process.exit(1);
  }
  console.log(`overrides-effective-gate: PASS — all ${names.length} override(s) apply to every resolved node.`);
  // Report per package NAME, not per key: E1 is an assertion about every node of a name, and
  // several keys (e.g. fast-uri@3 and fast-uri@4) share one name. Printing per key would repeat
  // the same node set under each and read as though a 3.x pin had resolved a 4.x version.
  const byName = new Map();
  for (const [key, pin] of Object.entries(overrides)) {
    const name = overrideKeyToName(key);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(`${key} -> ${pin}`);
  }
  for (const [name, entries] of byName) {
    const nodes = collectNodes(tree, name);
    const versions = [...new Set(nodes.map((n) => n.version))].sort().join(', ');
    console.log(`  ${name}: ${entries.join(' | ')}`);
    console.log(`    ${nodes.length} node(s), all overridden, resolved: ${versions}`);
  }
}

main();
