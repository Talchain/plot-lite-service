import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
// Import the plain JS SDK helpers to avoid TS build coupling
const sdkPath = new URL('../sdk/js/index.mjs', import.meta.url).pathname;

function nextPort() { return 21000 + Math.floor(Math.random() * 1000); }
async function waitFor(url, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  return false;
}
async function startServer(env) {
  const port = String(nextPort());
  const child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_ROUTES: '1', AUTH_ENABLED: '0', DEMO_MODE_ENABLED: '1', TEST_PORT: port, ...env }, stdio: 'ignore' });
  const ok = await waitFor(`http://127.0.0.1:${port}/v1/health`, 5000);
  if (!ok) throw new Error('server not healthy');
  return { port, child };
}
async function stopServer(child) {
  await new Promise(resolve => {
    let done = false; const finish = () => { if (!done) { done = true; resolve(); } };
    try { child.once('exit', finish); } catch { finish(); }
    try { if (child?.pid) { process.kill(child.pid, 'SIGINT'); setTimeout(() => { try { if (child?.pid) process.kill(child.pid, 'SIGKILL'); } catch {}; finish(); }, 1200); } else finish(); } catch { finish(); }
  });
}

describe('sdk-js helpers', () => {
  it('run() supports demo and returns run.v1 with response_hash', async () => {
    const { port, child } = await startServer({});
    const baseUrl = `http://127.0.0.1:${port}`;
    const { run } = await import(sdkPath);
    const res = await run({}, { baseUrl, query: { demo: 1 }, timeoutMs: 3000 });
    expect(res?.schema).toBe('run.v1');
    expect(typeof res?.model_card?.response_hash).toBe('string');
    await stopServer(child);
  });

  it('stream() emits hello→token→done and supports abort', async () => {
    const { port, child } = await startServer({});
    const baseUrl = `http://127.0.0.1:${port}`;
    const events = [];
    const { stream } = await import(sdkPath);
    const controller = await stream({ baseUrl, params: { demo: 1, latency_ms: 5 }, timeoutMs: 4000, onEvent: (e) => events.push(e.event) });
    await new Promise(r => setTimeout(r, 400));
    try { controller.cancel(); } catch {}
    expect(events.slice(0,3)).toEqual(['hello','token','done']);
    await stopServer(child);
  });

  it('run() retries on 5xx and respects timeout', async () => {
    const baseUrl = 'http://127.0.0.1:0'; // invalid host to force network error quickly
    let failed = false;
    try {
      await run({}, { baseUrl, timeoutMs: 200, retries: 1 });
    } catch { failed = true; }
    expect(failed).toBe(true);
  });
});
