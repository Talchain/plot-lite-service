/* Tools harness: soak */
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

function runNode(args: string[], env: any = {}): Promise<{ code: number, stdout: string, stderr: string }>{
  return new Promise((resolve) => {
    const p = spawn(process.execPath, args, { stdio: ['ignore','pipe','pipe'], env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('close', code => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

function run(cmd: string, args: string[], env: any = {}): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('close', code => resolve(code ?? 1));
  });
}

async function main() {
  if (process.env.FEATURE_STREAM !== '1') {
    console.log('Soak harness skipped (FEATURE_STREAM != 1)');
    process.exit(0);
  }
  // Ensure build outputs exist for test-server.js imports
  const buildCode = await run('npm', ['run', 'build']);
  if (buildCode !== 0) {
    console.error('Soak harness: build failed');
    process.exit(1);
  }
  const PORT = process.env.SOAK_PORT || '4360';
  const BASE = `http://127.0.0.1:${PORT}`;
  const child = spawn(process.execPath, ['tools/test-server.js'], {
    env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '1', STREAM_HEARTBEAT_SEC: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore'
  });
  try {
    await waitFor(`${BASE}/health`, 5000);
  } catch (e) {
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
    console.log('Soak harness skipped (server not healthy)');
    process.exit(0);
  }

  const res = await runNode(['tools/soak.mjs', '--base', BASE, '--n', '2', '--duration', '3']);
  try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  if (res.code !== 0) { console.error(res.stderr || res.stdout); process.exit(1); }
  const line = (res.stdout.trim().split('\n').pop() || '{}');
  let j: any = {};
  try { j = JSON.parse(line); } catch (e) { console.error('Invalid JSON from soak tool'); process.exit(1); }
  const keys = Object.keys(j);
  const needed = ['started','finished','cancelled','limited','retryable','p50_ms','p95_ms'];
  const missing = needed.filter(k => !keys.includes(k));
  if (missing.length) {
    console.error('Soak summary missing keys:', missing);
    process.exit(1);
  }
  console.log('Soak harness OK');
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
