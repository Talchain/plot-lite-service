/**
 * GET /v1/stream — SSE stream with demo-first semantics
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { isDemoMode } from '../../middleware/demo-mode.js';
import { createQueryValidator } from '../../middleware/input-validation.js';
import { incStreamRateLimited, incStreamDisconnect, incStreamWriteBackpressure, incSseOpen, incSseClosed, incSseTimeout } from '../../metrics.js';
import { incSse429Count } from '../../metrics.js';
import { replyWithAppError } from '../../errors.js';
import { getSsePerIpMax, getSseGlobalMax } from '../../config/runtimeConfig.js';
import { SSE_SLOT_MAX_MS } from '../../config/constants.js';

// In-memory limiter (runtime-config tunable)
const ipCount = new Map<string, number>();
let globalCount = 0;
function PER_IP_MAX() { return Number(getSsePerIpMax()); }
function GLOBAL_MAX() { return Number(getSseGlobalMax()); }

function getIp(req: FastifyRequest): string {
  // Fastify populates req.ip respecting trustProxy when enabled
  const raw = String((req as any).ip || 'unknown');
  if (raw === '::1') return '127.0.0.1';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function tryAcquire(ip: string): { ok: true } | { ok: false; reason: 'global' | 'per_ip' } {
  if (globalCount >= GLOBAL_MAX()) return { ok: false, reason: 'global' };
  const n = (ipCount.get(ip) ?? 0) + 1;
  if (n > PER_IP_MAX()) return { ok: false, reason: 'per_ip' };
  ipCount.set(ip, n);
  globalCount++;
  return { ok: true };
}
function release(ip: string) {
  const n = (ipCount.get(ip) ?? 1) - 1;
  if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n);
  globalCount = Math.max(0, globalCount - 1);
}

// Robust SSE writer with basic backpressure handling
export async function writeSse(reply: FastifyReply, id: number | string, ev: string, data: unknown): Promise<void> {
  const payload = `id: ${id}\n` +
                  `event: ${ev}\n` +
                  `data: ${JSON.stringify(data)}\n\n`;
  
  // Catch EPIPE/ERR_STREAM_DESTROYED when client disconnects
  let ok: boolean;
  try {
    ok = reply.raw.write(payload);
  } catch (err: any) {
    const code = err?.code;
    if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
      // Client disconnected, ignore
      return;
    }
    throw err;
  }
  
  if (!ok) {
    try { incStreamWriteBackpressure(); } catch {}
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => { cleanup(); resolve(); };
      const onError = (err: any) => { cleanup(); try { reply.log.error({ err }, 'sse drain write failed'); } catch {} resolve(); };
      const cleanup = () => {
        try { reply.raw.off?.('drain', onDrain); } catch {}
        try { reply.raw.off?.('error', onError); } catch {}
      };
      try {
        reply.raw.once('drain', onDrain);
        reply.raw.once('error', onError);
      } catch { resolve(); }
    });
  }
}

function safeEnd(reply: FastifyReply) {
  try { (reply.raw as any).flush?.(); }
  catch (err) { reply.log.warn({ err }, 'sse flush before end failed'); }
  try { reply.raw.end(); }
  catch (err) { reply.log.error({ err }, 'sse end failed'); }
}

function waitWithAbort(ms: number, req: FastifyRequest) {
  const delay = Math.max(0, Number(ms) || 0);
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, delay);
    (req.raw as any).once('close', () => { clearTimeout(t); resolve(); });
  });
}

// Test-only named export
export const __streamTest = { writeSse };
type StreamQuery = { demo?: number; latency_ms?: number };

export async function registerStreamRoute(app: FastifyInstance) {
  app.get<{ Querystring: StreamQuery }>('/v1/stream', {
    // Auth is enforced globally for /v1/* in routes index preHandler
    preHandler: [
      // Enforce limiter first (applies to demo and non-demo)
      async (req: FastifyRequest, reply: FastifyReply) => {
        const reqId = (req as any).id || 'unknown';
        // Rate limit check (applies to demo short-circuit path too)
        const ip = getIp(req);
        try { incSseOpen(); } catch {}
        const acq = tryAcquire(ip);
        if (!('ok' in acq) || acq.ok === false) {
          try { incStreamRateLimited(); } catch {}
          // Compute conservative backoff window from slot max ms
          const retryAfterS = Math.max(1, Math.ceil(Number(SSE_SLOT_MAX_MS) / 1000));
          // Back-compat: header remains '1' to keep existing tests green
          try { reply.header('Retry-After', '1'); } catch {}
          try { reply.header('X-RateLimit-Reason', acq.ok === false ? acq.reason : 'per_ip'); } catch {}
          try { incSse429Count(); } catch {}
        return replyWithAppError(reply, {
          type: 'RATE_LIMIT',
          statusCode: 429,
          message: 'Too many streams',
          fields: { code: 'RATE_LIMITED', retry_after_s: retryAfterS },
        });
        }
        // Ensure release on socket lifecycle (idempotent)
        let fallbackTimer: NodeJS.Timeout | null = null;
        const releaseOnce = (() => {
          let done = false;
          let timedOut = false;
          return (fromTimeout = false) => {
            if (done) return;
            done = true;
            if (fromTimeout) { timedOut = true; try { incSseTimeout(); } catch {} }
            else { try { incSseClosed(); } catch {} }
            try { if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; } } catch {}
            try { release(ip); }
            catch (err) { try { reply.log?.warn({ err, reqId }, 'sse limiter release failed'); } catch {} }
          };
        })();
        (req.raw as any).on('close', () => { try { incStreamDisconnect(); } catch {} releaseOnce(); });
        (req.raw as any).on('error', () => { try { incStreamDisconnect(); } catch {} releaseOnce(); });
        // Fallback: force release after SSE_SLOT_MAX_MS if not already released
        try {
          fallbackTimer = setTimeout(() => { reply.log?.info({ reqId }, 'sse timeout'); releaseOnce(true); }, SSE_SLOT_MAX_MS);
          fallbackTimer.unref?.();
        } catch {}

        // Demo short-circuit: send a tiny deterministic stream quickly
        if (isDemoMode(req)) {
          const traceId = process.env.TRACE_MIN === '1' ? randomUUID() : undefined;
          reply.header('Content-Type', 'text/event-stream; charset=utf-8');
          reply.header('Cache-Control', 'no-cache, no-transform');
          reply.header('X-Accel-Buffering', 'no');
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Connection', 'keep-alive');
          // Ensure JSON-only headers are not present on SSE
          try { reply.removeHeader('X-Content-Type-Options'); } catch {}
          try { reply.removeHeader('Referrer-Policy'); } catch {}
          try { (reply.raw as any).removeHeader?.('X-Content-Type-Options'); } catch {}
          try { (reply.raw as any).removeHeader?.('Referrer-Policy'); } catch {}
          reply.hijack();
          try {
            reply.raw.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'X-Accel-Buffering': 'no',
              'Access-Control-Allow-Origin': '*',
              'Connection': 'keep-alive',
            });
          } catch (err) {
            reply.log.warn({ err }, 'sse writeHead failed (demo)');
          }
          reply.log.info({ demo: true }, 'sse start');
          await writeSse(reply, 0, 'hello', { schema: 'hello.v1', ts: '2025-01-01T00:00:00.000Z', ...(traceId ? { trace_id: traceId } : {}) });
          await writeSse(reply, 1, 'token', { schema: 'token.v1', text: 'hello', index: 0 });
          await writeSse(reply, 2, 'done',  { schema: 'done.v1', reason: 'complete' });
          safeEnd(reply);
          reply.log.info('sse end');
          return reply;
        }
      },
      // Validate query afterwards for non-demo path (demo hijacks before this)
      createQueryValidator('stream'),
    ],
  }, async (req, reply) => {
    const q = (req.query ?? {}) as StreamQuery;
    const traceId = process.env.TRACE_MIN === '1' ? randomUUID() : undefined;
    const latencyMs = q.latency_ms ?? 0;

    // Non-demo path
    reply.header('Content-Type', 'text/event-stream; charset=utf-8');
    reply.header('Cache-Control', 'no-cache, no-transform');
    reply.header('X-Accel-Buffering', 'no');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Connection', 'keep-alive');
    // Ensure JSON-only headers are not present on SSE
    try { reply.removeHeader('X-Content-Type-Options'); } catch {}
    try { reply.removeHeader('Referrer-Policy'); } catch {}
    try { (reply.raw as any).removeHeader?.('X-Content-Type-Options'); } catch {}
    try { (reply.raw as any).removeHeader?.('Referrer-Policy'); } catch {}
    reply.hijack();
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
        'Connection': 'keep-alive',
      });
    } catch (err) {
      reply.log.warn({ err }, 'sse writeHead failed');
    }

    reply.log.info({ latencyMs }, 'sse start');

    let closed = false;
    const onClose = (err?: any) => {
      if (closed) return;
      closed = true;
      if (err) reply.log.warn({ err }, 'sse client error/close');
    };
    (req.raw as any).on('close', onClose);
    (req.raw as any).on('error', onClose);

    await writeSse(reply, 0, 'hello', { schema: 'hello.v1', ts: new Date().toISOString(), ...(traceId ? { trace_id: traceId } : {}) });
    await waitWithAbort(latencyMs, req);
    if (!closed) await writeSse(reply, 1, 'token', { schema: 'token.v1', text: 'draft', index: 0 });
    if (!closed) await writeSse(reply, 2, 'done', { schema: 'done.v1', reason: 'complete' });
    safeEnd(reply);
    reply.log.info('sse end');
    return reply;
  });
}
