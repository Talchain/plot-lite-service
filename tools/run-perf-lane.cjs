#!/usr/bin/env node
// Start a temporary test server and run loadcheck.mjs against it, then exit with the same code.
const { spawn } = require('node:child_process');

function waitFor(url, timeoutMs = 10000) {
  const start = Date.now();
  return new Promise(async (resolve, reject) => {
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve(true);
      } catch {}
      await new Promise(r => setTimeout(r, 120));
    }
    reject(new Error('timeout'));
  });
}

(async () => {
  const PORT = process.env.PERF_TEST_PORT || '4344';
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' };
  const server = spawn(process.execPath, ['tools/test-server.js'], { stdio: 'inherit', env });
  try {
    await waitFor(`${BASE}/health`, 10000);
  } catch (e) {
    try { server.kill('SIGINT'); } catch {}
    console.error('perf-lane: server readiness failed');
    process.exit(1);
  }
  const child = spawn(process.execPath, ['tools/loadcheck.mjs'], { stdio: 'inherit', env: { ...env, TEST_BASE_URL: BASE } });
  child.on('close', (code) => {
    try { server.kill('SIGINT'); } catch {}
    process.exit(code || 0);
  });
})();
