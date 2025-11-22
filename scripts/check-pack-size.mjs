#!/usr/bin/env node
import { readdirSync, statSync } from 'fs';

const outDir = 'out';
const packs = readdirSync(outDir).filter(f => /^engine_pack_.*\.zip$/.test(f));

if (packs.length === 0) {
  console.log('GATES: WARN — no pack found');
  process.exit(0);
}

const pack = packs[0];
const size = statSync(`${outDir}/${pack}`).size;
const sizeMB = (size / 1048576).toFixed(2);
const within = size <= 10485760;

console.log(`GATES: ${within ? 'PASS' : 'FAIL'} — pack size ${sizeMB}MB ${within ? 'within' : 'exceeds'} 10MB budget`);
process.exit(within ? 0 : 1);
