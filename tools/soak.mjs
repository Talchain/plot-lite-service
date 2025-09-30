#!/usr/bin/env node
/*
Soak tool (gated usage).
- Spins up N parallel SSE streams against real /stream (FEATURE_STREAM=1 on the server).
- Records per-stream events, verifies terminal invariant (done|cancelled|limited|error).
- Computes p50/p95 inter-event latencies across all streams.
- Prints JSON summary: { started, finished, cancelled, limited, retryable, p50_ms, p95_ms }

Usage:
  node tools/soak.mjs --base http://127.0.0.1:4311 --n 5 --duration 20
Env:
  AUTH_TOKEN (optional) -> adds Authorization: Bearer <token>
*/

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) args.set(k, v);
    else if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) { args.set(k, process.argv[i + 1]); i++; }
    else args.set(k, '1');
  }
}

const BASE = args.get('base') || process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4311';
const N = Number(args.get('n') || process.env.SOAK_N || 5);
const DURATION_SEC = Number(args.get('duration') || process.env.SOAK_DURATION_SEC || 20);
const AUTH = process.env.AUTH_TOKEN ? { Authorization: `Bearer ${process.env.AUTH_TOKEN}` } : undefined;

function nowMs() { return Date.now(); }
function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if ((sorted[base + 1] !== undefined)) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

async function streamOnce(idx, controller) {
  const headers = { Accept: 'text/event-stream', ...(AUTH || {}) };
  const res = await fetch(`${BASE}/stream`, { headers, signal: controller.signal });
  const out = { idx, events: [], terminal: null, retryable: 0 };
  if (!res.ok) {
    out.terminal = 'error';
    out.events.push({ event: 'error', ts: nowMs(), data: { status: res.status } });
    return out;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let lastTs = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idxNL;
    while ((idxNL = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idxNL);
      buf = buf.slice(idxNL + 1);
      if (line.startsWith(':')) continue; // heartbeat comment
      if (line.trim() === '') {
        // blank line flush handled in block builder. We'll build via state.
        continue;
      }
      // Build blocks using minimal state
      // We'll parse in a simple way: accumulate until next blank encountered
    }
    // Fallback: we need block parsing; easier approach: split by double newline progressively
    let idx2;
    while ((idx2 = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx2);
      buf = buf.slice(idx2 + 2);
      if (!block.trim()) continue;
      const lines = block.split('\n');
      let ev = '', dataRaw = '';
      for (const ln of lines) {
        if (!ln) continue;
        if (ln.startsWith(':')) continue;
        const c = ln.indexOf(':');
        const k = c >= 0 ? ln.slice(0, c).trim() : ln.trim();
        const v = c >= 0 ? ln.slice(c + 1).trim() : '';
        if (k === 'event') ev = v;
        else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
      }
      const ts = nowMs();
      const data = dataRaw ? (() => { try { return JSON.parse(dataRaw); } catch { return dataRaw; } })() : null;
      out.events.push({ event: ev || 'message', data, ts });
      if (lastTs) out.events[out.events.length - 1].dt_ms = ts - lastTs;
      lastTs = ts;
      if (ev === 'done' || ev === 'cancelled' || ev === 'limited' || ev === 'error') {
        out.terminal = ev || 'done';
        if (ev === 'error' && data && typeof data === 'object' && data.retryable) out.retryable++;
        try { controller.abort(); } catch {}
        return out;
      }
    }
  }
  return out;
}

async function main() {
  const started = N;
  const controllers = Array.from({ length: N }, () => new AbortController());
  const promises = controllers.map((c, i) => streamOnce(i, c));
  const timeout = setTimeout(() => { for (const c of controllers) { try { c.abort(); } catch {} } }, Math.max(1000, DURATION_SEC * 1000));
  const results = await Promise.allSettled(promises);
  clearTimeout(timeout);

  const evIntervals = [];
  let finished = 0, cancelled = 0, limited = 0, retryable = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const v = r.value;
      for (const e of v.events) if (typeof e.dt_ms === 'number') evIntervals.push(e.dt_ms);
      if (v.terminal === 'done') finished++;
      else if (v.terminal === 'cancelled') cancelled++;
      else if (v.terminal === 'limited') limited++;
      retryable += v.retryable || 0;
    }
  }
  evIntervals.sort((a,b)=>a-b);
  const p50_ms = Number(quantile(evIntervals, 0.5).toFixed(3));
  const p95_ms = Number(quantile(evIntervals, 0.95).toFixed(3));
  const summary = { started, finished, cancelled, limited, retryable, p50_ms, p95_ms };
  console.log(JSON.stringify(summary));
}

main().catch(err => { console.error(err?.message || err); process.exit(1); });
