#!/usr/bin/env node
/*
Replay tool.
- Consumes a saved NDJSON of SSE events and validates schema per event type.
- Optionally emits SSE to stdout with --emit (for piping), but primary output is a JSON summary to stdout.
- Prints JSON summary with checksum and any validation errors.

Usage:
  node tools/replay.mjs --file fixtures/golden-seed-4242/stream.ndjson [--emit]
*/

import { createReadStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';

function parseArgs() {
  const out = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out.set(k, v);
      else if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) { out.set(k, process.argv[i + 1]); i++; }
      else out.set(k, '1');
    }
  }
  return out;
}

const args = parseArgs();
const file = resolvePath(String(args.get('file') || ''));
const emit = args.get('emit') === '1' || args.get('emit') === 'true';

if (!file) {
  console.error('Missing --file <path>');
  process.exit(2);
}

function checksumSha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function validateEvent(ev) {
  const allowed = new Set(['hello','token','cost','done','cancelled','limited','error']);
  const errs = [];
  if (!allowed.has(ev.event)) errs.push(`invalid_event:${ev.event}`);
  const d = ev.data;
  const t = ev.event;
  function req(obj, key, type) { if (typeof obj?.[key] !== type) errs.push(`${t}.${key}:${typeof obj?.[key]}`); }
  if (t === 'hello') { req(d, 'ts', 'string'); }
  if (t === 'token') { req(d, 'text', 'string'); req(d, 'index', 'number'); }
  if (t === 'cost') { req(d, 'tokens', 'number'); req(d, 'currency', 'string'); req(d, 'amount', 'number'); }
  if (t === 'done') { req(d, 'reason', 'string'); }
  if (t === 'error') { /* best-effort */ }
  if (t === 'limited') { /* best-effort */ }
  if (t === 'cancelled') { /* best-effort */ }
  return errs;
}

async function main() {
  const raw = readFileSync(file);
  const hash = checksumSha256(raw);

  const rs = createReadStream(file, { encoding: 'utf8' });
  let buf = '';
  let count = 0;
  const errors = [];

  rs.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const ev = { event: String(obj.event || ''), data: obj.data };
        const e = validateEvent(ev);
        if (e.length) errors.push({ line: count + 1, errors: e });
        if (emit) {
          process.stdout.write(`id: ${count}\n`);
          process.stdout.write(`event: ${ev.event}\n`);
          process.stdout.write(`data: ${JSON.stringify(ev.data ?? null)}\n\n`);
        }
        count++;
      } catch (e) {
        errors.push({ line: count + 1, errors: ['invalid_json'] });
      }
    }
  });
  await new Promise((resolve) => rs.on('end', resolve));

  const summary = { file, events: count, errors: errors.length, checksum_sha256: hash, error_details: errors.slice(0, 10) };
  console.log(JSON.stringify(summary));
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
