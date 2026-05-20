import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function nextPort() { return 22600 + Math.floor(Math.random() * 500); }

async function waitHealth(base: string, to = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < to) {
    try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(80);
  }
  return false;
}

/**
 * This test rewrites its runtime-config file mid-test (initial config then
 * post-reload config). Each test instance gets a private temp file so the
 * mid-test rewrite cannot collide with any other test's runtime config under
 * vitest's multi-threaded pool.
 */
function makeIsolatedRuntimeConfig(initial: Record<string, unknown>): {
  path: string;
  rewrite: (next: Record<string, unknown>) => void;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'plot-config-hotreload-'));
  const path = join(dir, 'runtime-config.json');
  writeFileSync(path, JSON.stringify(initial, null, 2));
  return {
    path,
    rewrite: (next) => writeFileSync(path, JSON.stringify(next, null, 2)),
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

describe('runtime config hot-reload', () => {
  it('SIGHUP reload increases sse_per_ip_max from 1 to 2', async () => {
    const PORT = nextPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    const cfg = makeIsolatedRuntimeConfig({ sse_per_ip_max: 1, sse_global_max: 100, rate_limit_rpm: 60 });
    const env = {
      ...process.env,
      PORT: String(PORT),
      TEST_ROUTES: '1',
      AUTH_ENABLED: '0',
      SSE_PER_IP_MAX: '1',
      RUNTIME_CONFIG_PATH: cfg.path,
    } as any;
    const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
    try {
      const up = await waitHealth(BASE);
      expect(up).toBe(true);
      const ac1 = new AbortController();
      const p1 = fetch(`${BASE}/v1/stream?latency_ms=2500`, { signal: ac1.signal }).then(r => r.status).catch(() => 0);
      await sleep(150);
      const r429 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
      expect(r429.status).toBe(429);
      cfg.rewrite({ sse_per_ip_max: 2, sse_global_max: 100, rate_limit_rpm: 60 });
      try { ps.kill('SIGHUP'); } catch {}
      await sleep(250);
      const r200 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
      expect(r200.status).toBe(200);
      try { ac1.abort(); } catch {}
    } finally {
      try { ps.kill('SIGTERM'); } catch {}
      cfg.cleanup();
    }
  }, 15000);
});
