/* Tools harness: replay */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

function runNode(args: string[], env: any = {}): Promise<{ code: number, stdout: string, stderr: string }>{
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore','pipe','pipe'], env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

async function main() {
  // Ensure tiny NDJSON fixture exists
  const fxDir = resolvePath('tests','fixtures');
  const fx = resolvePath(fxDir, 'replay-valid.ndjson');
  if (!existsSync(fx)) {
    mkdirSync(fxDir, { recursive: true });
    writeFileSync(fx, [
      JSON.stringify({ event: 'hello', data: { ts: new Date().toISOString() } }),
      JSON.stringify({ event: 'token', data: { text: 'draft', index: 0 } }),
      JSON.stringify({ event: 'cost', data: { tokens: 5, currency: 'USD', amount: 0 } }),
      JSON.stringify({ event: 'done', data: { reason: 'complete' } }),
      ''
    ].join('\n'), 'utf8');
  }

  const res = await runNode(['tools/replay.mjs', '--file', fx]);
  if (res.code !== 0) { console.error(res.stderr || res.stdout); process.exit(1); }
  const line = (res.stdout.trim().split('\n').pop() || '{}');
  let j: any = {};
  try { j = JSON.parse(line); } catch (e) { console.error('Invalid JSON from replay tool'); process.exit(1); }
  const keys = Object.keys(j);
  const has = (k: string) => keys.includes(k);
  if (!has('events') || !has('errors') || !(has('checksum_sha256') || has('checksum'))) {
    console.error('Replay summary missing expected keys:', keys);
    process.exit(1);
  }
  if (typeof j.errors !== 'number' || j.errors !== 0) {
    console.error('Replay summary errors != 0:', j.errors);
    process.exit(1);
  }
  console.log('Replay harness OK');
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
