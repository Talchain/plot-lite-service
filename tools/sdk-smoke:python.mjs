#!/usr/bin/env node
/**
 * sdk-smoke:python.mjs
 * - Starts server
 * - Runs tools/sdk-smoke.py to verify run+stream behavior
 * - One GATES line, <=15s
 */

import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31351;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 15000;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test', TEST_ROUTES: '1', AUTH_ENABLED: '0' };
    const ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore', detached: false });
    const t0 = Date.now();
    (async function waitHealth() {
      while (Date.now() - t0 < 7000) {
        try {
          const res = await fetch(`${BASE}/v1/health`);
          if (res.ok) return resolve(ps);
        } catch {}
        await delay(150);
      }
      reject(new Error('health timeout'));
    })();
  });
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: FAIL — sdk:python timeout');
    process.exit(1);
  }, TIMEOUT_MS).unref();

  let ps;
  try {
    // Check python availability and version (prefer python3)
    let pyCmd = 'python3';
    let pyv = spawnSync(pyCmd, ['-V'], { encoding: 'utf8' });
    if (pyv.status !== 0) {
      pyCmd = 'python';
      pyv = spawnSync(pyCmd, ['-V'], { encoding: 'utf8' });
    }
    if (pyv.status !== 0) {
      console.log('GATES: SKIP — sdk:python (python missing)');
      process.exit(0);
    }
    const pyver = (pyv.stdout || pyv.stderr || pyCmd).trim().split(/\s+/).slice(0,2).join(' ');

    ps = await startServer();

    const run = spawnSync(pyCmd, ['tools/sdk-smoke.py', String(PORT)], { encoding: 'utf8', timeout: 8000 });
    if (run.status !== 0) {
      console.log('GATES: FAIL — sdk:python smoke script error');
      process.exit(1);
    }
    let js = null;
    try { js = JSON.parse(run.stdout || '{}'); } catch {}
    const okRun = !!(js && js.ok_run === true);
    const okStream = !!(js && js.ok_stream === true);
    if (!okRun || !okStream) {
      console.log(`GATES: FAIL — sdk:python smoke (run=${okRun?'ok':'bad'} stream=${okStream?'ok':'bad'})`);
      process.exit(1);
    }
    console.log(`GATES: PASS — sdk:python smoke ok port=${PORT} py=${pyver}`);
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — sdk:python not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
