#!/usr/bin/env node
/**
 * Generate src/util/structural-keys.generated.ts — the set of object KEY names
 * that redactPayloadShape preserves verbatim (Wave1-L1, review-3 residual).
 *
 * WHY GENERATED: redactPayloadShape must digest DATA-DERIVED keys (e.g.
 * `interventions` is a Record KEYED BY NODE ID, and node ids are label-derived
 * slugs — the key IS decision content) while preserving CONTRACT-DEFINED keys
 * so the payload shape stays navigable for debugging.
 *
 * The distinction is exactly "is this key a declared field in the wire
 * contract?". Rather than hand-maintaining a denylist that silently rots as
 * the contract evolves, we DERIVE the structural set from the contract type
 * declarations themselves. `tests/util/structural-keys-drift.test.ts` re-runs
 * this extraction and fails if the checked-in file has drifted, so a new
 * contract field cannot quietly start being digested.
 *
 * Index-signature keys (`[k: string]: X`) are deliberately NOT collected —
 * those are precisely the data-derived maps whose keys must be digested.
 *
 * Codex F6: importing this module is SIDE-EFFECT-FREE. The old version ran
 * its write at module top level, so the drift test's `import` REGENERATED the
 * registry before comparing — the guard could never fail (it passed for
 * months over a stale committed file). Writing now happens ONLY under direct
 * CLI invocation; the drift test calls the pure `checkRegistry()` instead.
 *
 * Usage: node tools/gen-structural-keys.mjs [--check]
 *   (no flag)  regenerate src/util/structural-keys.generated.ts
 *   --check    exit 1 if the checked-in file differs from the derivation
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Contract type declarations that describe payloads crossing the boundary. */
export const CONTRACT_FILES = [
  'src/types/engine-v3.ts',
  'src/integrations/isl/types/isl-types.ts',
];

/** Absolute path of the generated registry. */
export const GENERATED_PATH = join(ROOT, 'src/util/structural-keys.generated.ts');

/** Extract every declared property name from the contract type files. */
export function extractStructuralKeys() {
  const names = new Set();
  for (const rel of CONTRACT_FILES) {
    const abs = join(ROOT, rel);
    const sf = ts.createSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true);
    const walk = (node) => {
      // PropertySignature = a declared field on an interface / type literal.
      // Index signatures are a different node kind and are skipped by design.
      if (ts.isPropertySignature(node) && node.name) {
        const raw = node.name.getText(sf);
        const name = raw.replace(/^['"]|['"]$/g, '');
        if (!name.startsWith('[')) names.add(name);
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return [...names].sort();
}

export function renderModule(keys) {
  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: node tools/gen-structural-keys.mjs
 * Drift is enforced by tests/util/structural-keys-drift.test.ts.
 *
 * Object KEY names declared by the wire contract (${CONTRACT_FILES.join(', ')}).
 * redactPayloadShape preserves these verbatim so payload SHAPE survives
 * redaction; every other key is data-derived (e.g. the node-id keys of
 * \`interventions\`) and is digested.
 */

export const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
${keys.map((k) => `  ${JSON.stringify(k)},`).join('\n')}
]);
`;
}

/**
 * PURE check: derive the expected module text and compare it to the file on
 * disk. Never writes. This is what the drift test consumes.
 */
export function checkRegistry() {
  const expected = renderModule(extractStructuralKeys());
  const actual = readFileSync(GENERATED_PATH, 'utf8');
  return { ok: actual === expected, expected, actual };
}

// CLI entry — runs ONLY when this file is executed directly
// (`node tools/gen-structural-keys.mjs`), NEVER on import (Codex F6).
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  if (process.argv.includes('--check')) {
    const { ok } = checkRegistry();
    if (!ok) {
      console.error('structural-keys.generated.ts is STALE — run: node tools/gen-structural-keys.mjs');
      process.exit(1);
    }
    console.log('OK: structural-keys.generated.ts is up to date');
  } else {
    writeFileSync(GENERATED_PATH, renderModule(extractStructuralKeys()));
    console.log(`Wrote ${GENERATED_PATH}`);
  }
}
