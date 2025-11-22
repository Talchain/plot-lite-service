#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node tools/report-compare.cjs <a.json> <b.json>');
  process.exit(1);
}

function load(p) {
  const full = path.resolve(process.cwd(), p);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function main() {
  const [,, A, B] = process.argv;
  if (!A || !B) usage();
  const a = load(A);
  const b = load(B);
  const out = [];
  out.push(`# Summary`);
  out.push(`A: ok=${a.summary?.ok}/${a.summary?.total}, durationMs=${a.summary?.durationMs}`);
  out.push(`B: ok=${b.summary?.ok}/${b.summary?.total}, durationMs=${b.summary?.durationMs}`);
  if (a.summary?.ok !== b.summary?.ok || a.summary?.total !== b.summary?.total) {
    out.push(`! Summary changed`);
  }
  const aCases = new Map((a.cases||[]).map(c => [c.name, c]));
  const bCases = new Map((b.cases||[]).map(c => [c.name, c]));
  const names = Array.from(new Set([...aCases.keys(), ...bCases.keys()])).sort();
  out.push(`\n# Cases`);
  for (const n of names) {
    const x = aCases.get(n); const y = bCases.get(n);
    if (!x) { out.push(`+ ${n} (added)`); continue; }
    if (!y) { out.push(`- ${n} (removed)`); continue; }
    if (x.ok !== y.ok || x.ms !== y.ms) {
      out.push(`~ ${n}: ${x.ok}/${x.ms} -> ${y.ok}/${y.ms}`);
    }
  }
  console.log(out.join('\n'));
}

main();
