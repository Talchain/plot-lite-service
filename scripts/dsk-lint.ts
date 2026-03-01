#!/usr/bin/env npx tsx
/**
 * DSK Linter CLI
 *
 * Usage:
 *   npx tsx scripts/dsk-lint.ts [path] [--fix-order]
 *
 * Defaults to data/dsk/v1.json if no path given.
 * Exit codes: 0 = clean, 1 = errors, 2 = warnings only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { lint, formatLintResult } from '../src/dsk/linter.js';
import type { DSKBundle } from '../src/dsk/types.js';

const args = process.argv.slice(2);
const fixOrder = args.includes('--fix-order');
const filePath = resolve(args.find((a) => !a.startsWith('--')) ?? 'data/dsk/v1.json');

let bundle: DSKBundle;
try {
  const raw = readFileSync(filePath, 'utf8');
  bundle = JSON.parse(raw) as DSKBundle;
} catch (e) {
  const msg = e instanceof SyntaxError
    ? `Malformed JSON in ${filePath}: ${e.message}`
    : `Cannot read ${filePath}: ${(e as Error).message}`;
  console.error(msg);
  process.exit(1);
}

// --fix-order: rewrite file with objects sorted by id
if (fixOrder) {
  const validObjects = bundle.objects.filter(
    (entry): entry is (typeof bundle.objects)[number] =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
  if (validObjects.length !== bundle.objects.length) {
    console.error(`Warning: ${bundle.objects.length - validObjects.length} malformed entries skipped during --fix-order`);
  }
  const sorted = [...validObjects].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  bundle.objects = sorted;
  writeFileSync(filePath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');
  console.log(`Rewrote ${filePath} with objects in canonical id order.`);
}

const result = lint(bundle);
console.log(formatLintResult(result));
process.exit(result.exitCode);
