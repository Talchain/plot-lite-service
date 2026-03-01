#!/usr/bin/env npx tsx
/**
 * DSK Hash CLI
 *
 * Usage:
 *   npx tsx scripts/dsk-hash.ts [path]
 *
 * Computes and prints the canonical SHA-256 hash of a DSK bundle.
 * Defaults to data/dsk/v1.json if no path given.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeDSKHash } from '../src/dsk/hash.js';
import type { DSKBundle } from '../src/dsk/types.js';

const filePath = resolve(process.argv[2] ?? 'data/dsk/v1.json');

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

const hash = computeDSKHash(bundle);
console.log(hash);
