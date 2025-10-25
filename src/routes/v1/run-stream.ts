import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { writeSse as writeRawSse } from './stream.js';
import { incStreamRateLimited, incStreamDisconnect, incSseOpen, incSseClosed, incSseTimeout, incSse429Count, incSseCancelled, incSseProgress } from '../../metrics.js';
import { getSsePerIpMax, getSseGlobalMax } from '../../config/runtimeConfig.js';
import { refreshFromEnv } from '../../config/runtimeConfig.js';
import { SSE_SLOT_MAX_MS } from '../../config/constants.js';
import { executeRun } from '../../lib/executeRun.js';
import { getSseHeartbeatMs } from '../../config/sseConfig.js';

interface RunState {
  id: string;
  startedAt: number;
  lastEmit: number;
  pct: number;
  hb?: NodeJS.Timeout | null;
  cancelled?: boolean;
  controller?: AbortController | null;
  reply?: FastifyReply | null;
  ip?: string;
  cancelNotified?: boolean;
  timedOut?: boolean;
}

const runs = new Map<string, RunState>();

async function smallDelay(ms:number=10){ return new Promise<void>(r=>{ try{ setTimeout(r, ms); } catch { r(); } }); }

async function writeSse(reply: FastifyReply, id: number | string, ev: string, data: unknown): Promise<void> {
  await writeRawSse(reply, id, ev, data);
}

function endSse(reply: FastifyReply) {
  try { (reply.raw as any).flush?.(); } catch {}
  try { reply.raw.end(); } catch {}
}

// Limiter helpers (same as /v1/stream)
const ipCount = new Map<string, number>();
let globalCount = 0;
function PER_IP_MAX() { return Number(getSsePerIpMax()); }
function GLOBAL_MAX() { return Number(getSseGlobalMax()); }
function getIp(req: FastifyRequest): string {
  const raw = String((req as any).ip || 'unknown');
  if (raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}
function tryAcquire(ip: string): { ok: true } | { ok: false; reason: 'global' | 'per_ip' } {
  if (globalCount >= GLOBAL_MAX()) return { ok: false, reason: 'global' } as const;
  const n = (ipCount.get(ip) ?? 0) + 1;
  if (n > PER_IP_MAX()) return { ok: false, reason: 'per_ip' } as const;
  ipCount.set(ip, n);
  globalCount++;
  return { ok: true } as const;
}
function release(ip: string) {
  const n = (ipCount.get(ip) ?? 1) - 1;
  if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n);
  globalCount = Math.max(0, globalCount - 1);
}

export async function registerRunStreamRoutes(app: FastifyInstance) {
  try { refreshFromEnv(); } catch {}

  // Capture config at route registration time (per-server-instance isolation)
  const slotMaxMs = Number(process.env.SSE_MAX_MS || SSE_SLOT_MAX_MS);
  const hbMs = Math.max(100, getSseHeartbeatMs() || 8000);
  const finalizeMs = Number(process.env.SSE_FINALIZE_DELAY_MS || 0);

  // POST /v1/run/stream — SSE run progress
  app.post('/v1/run/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = getIp(req);


    // sse_opened: increment when a new run stream is accepted
    try { incSseOpen(); } catch {}
    const acq = tryAcquire(ip);
    if (!('ok' in acq) || acq.ok === false) {
      try { incStreamRateLimited(); } catch {}
      try { reply.header('Retry-After', '1'); } catch {}
      try { reply.header('X-RateLimit-Reason', acq.ok === false ? acq.reason : 'per_ip'); } catch {}
      // sse_429: increment on slot-based limiter rejection
      try { incSse429Count(); } catch {}
      return reply.code(429).send({ schema: 'error.v1', code: 'RATE_LIMITED', message: 'Too many streams' });
    }

    // Accept header check
    const accept = String((req.headers as any)['accept'] || '').toLowerCase();
    if (!accept.includes('text/event-stream') && process.env.STREAM_RUN_FALLBACK !== '1') {
      release(ip);
      return reply.code(406).send({ schema: 'error.v1', code: 'NOT_ACCEPTABLE', message: 'Use Accept: text/event-stream' });
    }

    const run_id = 'run_' + randomUUID().replace(/-/g, '').slice(0, 16);
    const state: RunState = { id: run_id, startedAt: Date.now(), lastEmit: 0, pct: 0, controller: null, reply, ip, cancelNotified: false, timedOut: false };
    runs.set(run_id, state);

    // SSE headers
    reply.header('Content-Type', 'text/event-stream; charset=utf-8');
    reply.header('Cache-Control', 'no-cache, no-transform');
    reply.header('X-Accel-Buffering', 'no');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Connection', 'keep-alive');
    try { reply.removeHeader('X-Content-Type-Options'); } catch {}
    try { reply.removeHeader('Referrer-Policy'); } catch {}

    reply.hijack();
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
      });
    } catch {}

    // Emit RUN_STARTED immediately
    await writeSse(reply, 0, 'RUN_STARTED', {
      run_id,
      queued_at: new Date(state.startedAt).toISOString(),
      started_at: new Date().toISOString()
    });
    // Emit immediate heartbeat
    try { await writeSse(reply, 1, 'HEARTBEAT', { run_id, ts: new Date().toISOString() }); } catch {}

    let closed = false;
    const onClose = () => { if (closed) return; closed = true; try { incSseClosed(); } catch {} clearTimers(state); runs.delete(run_id); try { release(ip); } catch {} };
    (req.raw as any).on('close', () => { try { incStreamDisconnect(); } catch {} onClose(); });
    (req.raw as any).on('error', () => { try { incStreamDisconnect(); } catch {} onClose(); });

    // Heartbeat with configurable interval
    state.hb = setInterval(async () => {
      if (closed || state.cancelled) return;
      await writeSse(reply, 1, 'HEARTBEAT', { run_id, ts: new Date().toISOString() });
    }, hbMs);
    try { setTimeout(async () => { if (!closed && !state.cancelled) { await writeSse(reply, 1, 'HEARTBEAT', { run_id, ts: new Date().toISOString() }); } }, Math.max(200, Math.floor(hbMs*2))); } catch {}

    const body = (req as any).body || {};

    // Setup controller and slot timeout (TIMEOUT error on expiry)
    const controller = new AbortController();
    state.controller = controller;
    const timeout = setTimeout(async () => {
      if (closed) return;
      state.timedOut = true;
      try { controller.abort(new Error('timeout')); } catch {}
      try { await writeSse(reply, 7, 'ERROR', { run_id, code: 'TIMEOUT', message: 'Run timed out' }); } catch {}
      try { incSseTimeout(); } catch {}
      closed = true;
      try { endSse(reply); } catch {}
      clearTimers(state); runs.delete(run_id); release(ip);
      try { incSseClosed(); } catch {}
    }, slotMaxMs);

    // Emit progress from executeRun onProgress (throttle ~5Hz, cap at 90)
    let lastProgAt = 0;
    const emitProgress = async (pct: number) => {
      const now = Date.now();
      if (now - lastProgAt < 180) return; // ~5-6 Hz
      lastProgAt = now;
      state.pct = Math.min(90, Math.max(state.pct, Math.floor(pct)));
      // sse_progress_events: increment on each PROGRESS event
      try { incSseProgress(); } catch {}
      await writeSse(reply, 2, 'PROGRESS', {
        run_id,
        pct: state.pct,
        eta_ms: Math.max(0, 2000 - (now - state.startedAt)),
        stage: state.pct < 50 ? 'initializing' : (state.pct < 90 ? 'sampling' : 'finalizing'),
        samples_done: Math.round(state.pct * 10),
        samples_total: 1000,
      });
    };

    try {
      const { report } = await executeRun(body, {
        signal: controller.signal,
        onProgress: emitProgress,
        onInterim: async (data: any) => {
          if (closed || state.cancelled) return;
          await writeSse(reply, 4, 'INTERIM_FINDINGS', {
            run_id,
            top_signals: data?.top_signals || [],
            partial_confidence: data?.partial_confidence ?? null,
          });
        },
      });

      if (closed || state.cancelled || state.timedOut) { return reply; }

      // Finalize
      const finalizeDelayMs_ = Math.max(0, Number(finalizeMs || 0))
      if (finalizeDelayMs_ > 0) {
        const t0 = Date.now();
        let lastHb = Date.now();
        while (Date.now() - t0 < finalizeDelayMs_) {
          if ((controller as any).signal?.aborted || state.timedOut) {
            const r: any = (controller as any).signal?.reason;
            if (state.timedOut || (r && ((typeof r === 'string' && r === 'timeout') || (typeof r === 'object' && (r as any)?.message === 'timeout')))) {
              throw new Error('timeout');
            }
            const e: any = new Error('cancelled'); e.code = 'CANCELLED'; throw e;
          }
          const now = Date.now();
          if (now - lastHb >= hbMs) {
            try { await writeSse(reply, 1, 'HEARTBEAT', { run_id, ts: new Date().toISOString() }); } catch {}
            lastHb = now;
          }
          await smallDelay(20);
        }
        if (state.cancelled) { const e: any = new Error('cancelled'); e.code = 'CANCELLED'; throw e; }
      }

      state.pct = 100;

      try { await writeSse(reply, 1, 'HEARTBEAT', { run_id, ts: new Date().toISOString() }); } catch {}
      state.pct = 100;
      await writeSse(reply, 5, 'PROGRESS', { run_id, pct: 100, eta_ms: 0, stage: 'complete', samples_done: 1000, samples_total: 1000 });
      await writeSse(reply, 6, 'COMPLETE', { run_id, report });
      closed = true;
      try { incSseClosed(); } catch {}
      // sse_closed: increment on normal completion || error close
      await smallDelay(10);
      await smallDelay(10);
      await smallDelay(10);
      await smallDelay(10);
      endSse(reply);
      clearTimeout(timeout);
      clearTimers(state);
      runs.delete(run_id);
      release(ip);
      return reply;
    } catch (err: any) {
      const code = err?.code === 'CANCELLED' || state.cancelled ? 'CANCELLED' : ((err?.message === 'timeout' || state.timedOut) ? 'TIMEOUT' : 'INTERNAL');
      if (!state.cancelNotified) { await writeSse(reply, 7, 'ERROR', { run_id, code, message: code === 'CANCELLED' ? 'Run cancelled' : (code === 'TIMEOUT' ? 'Run timed out' : String(err?.message || 'internal error')) }); }
      try { incSseClosed(); } catch {}
      // sse_closed: increment on normal completion || error close
      await smallDelay(10);
      await smallDelay(10);
      endSse(reply);
      clearTimeout(timeout);
      clearTimers(state);
      runs.delete(run_id);
      release(ip);
      return reply;
    }
  });

  // POST /v1/run/:run_id/cancel — idempotent
  app.post('/v1/run/:run_id/cancel', async (req: any, reply: FastifyReply) => {
    const run_id = String(req.params?.run_id || '');
    const st = runs.get(run_id);
    if (!st) return reply.code(200).send({ ok: true, run_id, state: 'done' });
    st.cancelled = true;
    // sse_cancelled: increment on cancel endpoint
    try { incSseCancelled(); } catch {}
    try { st.controller?.abort(new Error('cancelled')); } catch {}
    try { if (st.reply && !st.cancelNotified) { st.cancelNotified = true; await writeSse(st.reply, 7, 'ERROR', { run_id, code: 'CANCELLED', message: 'Run cancelled' }); await smallDelay(10); } } catch {}
    try { if (st.ip) release(st.ip); } catch {}
    clearTimers(st);
    runs.delete(run_id);
    return reply.code(200).send({ ok: true, run_id, state: 'cancelled' });
  });
}

function clearTimers(s: RunState) {
  try { if (s.hb) clearInterval(s.hb); } catch {}
  s.hb = null;
}

export type { RunState };
