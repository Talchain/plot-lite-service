#!/usr/bin/env node
// tools/loadcheck-probe.cjs
// Programmatic load probe with readiness wait and autocannon/undici fallback.

const { setTimeout: sleep } = require('node:timers/promises');

function joinUrl(baseUrl, path) {
  const b = String(baseUrl || '').replace(/\/$/, '');
  const p = (path || '').startsWith('/') ? path : `/${path || ''}`;
  return `${b}${p}`;
}

async function waitForReadiness(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  const readyUrl = joinUrl(baseUrl, '/ready');
  const healthUrl = joinUrl(baseUrl, '/health');
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(readyUrl, { method: 'GET' });
      if (res.status === 200) return true;
    } catch {}
    try {
      const res2 = await fetch(healthUrl, { method: 'GET' });
      if (res2.status === 200) return true;
    } catch {}
    await sleep(150);
  }
  const err = new Error('readiness_timeout');
  err.name = 'ReadinessTimeout';
  throw err;
}

function quantile(arr, q) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const a = [...arr].sort((x, y) => x - y);
  const pos = Math.min(1, Math.max(0, q));
  const idx = Math.ceil(pos * a.length) - 1;
  return a[Math.max(0, Math.min(a.length - 1, idx))];
}

async function runWithAutocannon(baseUrl, path, connections, durationSeconds) {
  let autocannon;
  try {
    autocannon = require('autocannon');
  } catch {}
  if (!autocannon) return null;
  const url = joinUrl(baseUrl, path);
  // Many versions of autocannon return a promise when awaited
  const res = await autocannon({
    url,
    method: 'GET',
    connections,
    pipelining: 1,
    duration: durationSeconds,
    headers: { 'accept': 'application/json' },
  });
  const p50_ms = res?.latency?.p50 ?? null;
  const p95_ms = res?.latency?.p95 ?? null;
  const p99_ms = res?.latency?.p99 ?? null;
  const requests = res?.requests?.total ?? res?.requests?.average ?? null;
  const statusStats = res?.statusCodeStats || {};
  let non2xx = 0;
  for (const [code, count] of Object.entries(statusStats)) {
    const c = Number(code);
    if (!(c >= 200 && c < 300)) non2xx += Number(count || 0);
  }
  const errors = (res?.errors ?? 0) + (res?.timeouts ?? 0);
  return { p50_ms, p95_ms, p99_ms, requests, non2xx, errors };
}

async function runWithUndici(baseUrl, path, connections, durationSeconds) {
  const end = Date.now() + durationSeconds * 1000;
  let errors = 0;
  let non2xx = 0;
  const lats = [];
  const url = joinUrl(baseUrl, path);
  const worker = async () => {
    while (Date.now() < end) {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        const t1 = performance.now();
        lats.push(t1 - t0);
        if (!(res.status >= 200 && res.status < 300)) non2xx++;
        // Drain body to avoid socket backpressure
        try { await res.arrayBuffer(); } catch {}
      } catch {
        errors++;
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Number(connections) || 1) }, () => worker());
  await Promise.all(workers);
  return { p50_ms: quantile(lats, 0.5), p95_ms: quantile(lats, 0.95), p99_ms: quantile(lats, 0.99), requests: lats.length, non2xx, errors };
}

async function runProbe(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4311';
  const path = opts.path || '/draft-flows?template=pricing_change&seed=101';
  const connections = Number(opts.connections || 10);
  const durationSeconds = Number(opts.durationSeconds || 10);

  await waitForReadiness(baseUrl, 15000);

  const ac = await runWithAutocannon(baseUrl, path, connections, durationSeconds);
  if (ac && typeof ac.p95_ms === 'number') return ac;
  // Fallback
  return await runWithUndici(baseUrl, path, connections, durationSeconds);
}

module.exports = { runProbe };

// Allow direct CLI execution for ad-hoc runs
if (require.main === module) {
  (async () => {
    try {
      const res = await runProbe({});
      console.log(JSON.stringify(res));
      process.exit(0);
    } catch (e) {
      console.error('probe_error', e && e.message || e);
      process.exit(1);
    }
  })();
}
