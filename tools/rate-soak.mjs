#!/usr/bin/env node
// Mini rate soak — short bursts to exercise 429 headers and reset semantics
import { setTimeout as sleep } from 'node:timers/promises';

const base = process.env.TEST_BASE_URL || process.env.BASE || process.argv[2] || 'http://127.0.0.1:4311';
const N = Number(process.env.SOAK_N || 30);
const windowMs = Number(process.env.SOAK_WINDOW_MS || 3000);
const template = 'pricing_change';
const seed = 101;

async function fireOnce(i) {
  try {
    const r = await fetch(`${base}/draft-flows?template=${template}&seed=${seed}`);
    const limited = r.status === 429;
    const ra = Number(r.headers.get('retry-after') || '0');
    const reset = Number(r.headers.get('x-ratelimit-reset') || '0');
    return { limited, ra, reset };
  } catch {
    return { limited: false, ra: 0, reset: 0 };
  }
}

async function main() {
  const start = Date.now();
  const results = [];
  for (let i = 0; i < N; i++) {
    // spread uniformly over windowMs
    const due = start + Math.floor((i / Math.max(1, N - 1)) * windowMs);
    const delay = Math.max(0, due - Date.now());
    if (delay) await sleep(delay);
    results.push(await fireOnce(i));
  }
  const limitedCount = results.filter(r => r.limited).length;
  const first = results.find(r => r.limited) || null;
  const summary = {
    ok: true,
    limited: limitedCount,
    first_limit_at: first ? (Date.now() - start) : null,
    retry_after_min: results.filter(r => r.ra > 0).reduce((m, r) => Math.min(m, r.ra), Number.POSITIVE_INFINITY) || 0,
    reset_s: results.filter(r => r.reset > 0).map(r => r.reset).sort()[0] || 0,
  };
  console.log(JSON.stringify(summary));
}

main().catch(e => { console.error(e?.message || e); process.exit(1); });
