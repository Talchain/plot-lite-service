#!/usr/bin/env node
// Dev-only: replay golden SSE fixture to stdout as proper SSE lines
// Usage: npm run stream:replay
import { createReadStream } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const file = resolvePath('fixtures', 'golden-seed-4242', 'stream.ndjson');
let id = 0;
const rs = createReadStream(file, { encoding: 'utf8' });
let buf = '';
rs.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      const ev = obj.event || 'message';
      const data = obj.data ?? null;
      process.stdout.write(`id: ${id}\n`);
      process.stdout.write(`event: ${ev}\n`);
      process.stdout.write(`data: ${JSON.stringify(data)}\n\n`);
      id++;
    } catch {}
  }
});
rs.on('end', () => { /* done */ });
