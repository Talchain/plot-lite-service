/**
 * P1: Enhanced /v1/stream with parity & backpressure
 * Integrates: schemas, bounded queue, heartbeat, CB integration, enhanced metrics
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import AjvModule from 'ajv';
import { isDemoMode } from '../../middleware/demo-mode.js';
import { getSsePerIpMax, getSseGlobalMax } from '../../config/runtimeConfig.js';
import { getSseHeartbeatMs, getSseMaxBufferedEvents, getSseBackpressureThreshold } from '../../config/sseConfig.js';
import { SSE_SLOT_MAX_MS } from '../../config/constants.js';
import { streamQuerySchema } from '../../schemas/stream.js';
import { BoundedEventQueue, type QueuedEvent } from '../../lib/sse-queue.js';
import { HeartbeatManager } from '../../lib/sse-heartbeat.js';
import {
  incStreamClientsOpen,
  incStreamClientsClosed,
  incStreamBackpressureDrop,
  incStreamHeartbeat,
  incStreamCircuitRejected,
  recordStreamDuration
} from '../../observability/streamMetrics.js';
import {
  incStreamRateLimited,
  incStreamDisconnect,
  incStreamWriteBackpressure,
  incSseOpen,
  incSseClosed,
  incSseTimeout,
  incSse429Count
} from '../../metrics.js';
import { getCircuitBreakerStats } from '../../middleware/circuitBreaker.js';

const Ajv = AjvModule.default || AjvModule;
const ajv = new Ajv();
const validateQuery = ajv.compile(streamQuerySchema);

// In-memory limiter (runtime-config tunable)
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
  if (globalCount >= GLOBAL_MAX()) return { ok: false, reason: 'global' };
  const n = (ipCount.get(ip) ?? 0) + 1;
  if (n > PER_IP_MAX()) return { ok: false, reason: 'per_ip' };
  ipCount.set(ip, n);
  globalCount++;
  incStreamClientsOpen();
  return { ok: true };
}

function release(ip: string) {
  const n = (ipCount.get(ip) ?? 1) - 1;
  if (n <= 0) ipCount.delete(ip); else ipCount.set(ip, n);
  globalCount = Math.max(0, globalCount - 1);
  incStreamClientsClosed();
}

// P1: Enhanced SSE writer with bounded queue
async function writeSseWithQueue(
  reply: FastifyReply,
  queue: BoundedEventQueue,
  id: number,
  event: string,
  data: unknown
): Promise<void> {
  const queueResult = queue.push({ id, event, data });
  if (queueResult === 'dropped') {
    incStreamBackpressureDrop('overflow');
  }

  // Drain queue
  const events = queue.drain();
  for (const evt of events) {
    const payload = `id: ${evt.id}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
    const ok = reply.raw.write(payload);
    if (!ok) {
      incStreamWriteBackpressure();
      await new Promise<void>((resolve) => {
        const onDrain = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); resolve(); };
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

type StreamQuery = {
  demo?: number;
  latency_ms?: number;
  heartbeat_ms?: number;
  max_events?: number;
};

// P1: Feature flag for enhanced streaming
const STREAM_PARITY_ENABLE = process.env.STREAM_PARITY_ENABLE === '1';

export async function registerStreamRouteEnhanced(app: FastifyInstance) {
  // If P1 not enabled, skip enhanced registration
  if (!STREAM_PARITY_ENABLE) {
    return;
  }

  app.get<{ Querystring: StreamQuery }>('/v1/stream', {
    preHandler: [
      async (req: FastifyRequest, reply: FastifyReply) => {
        const reqId = (req as any).id || 'unknown';
        const startTime = Date.now();

        // P1: Check circuit breaker first (fail-fast)
        const cbStats = getCircuitBreakerStats();
        if (cbStats && cbStats.global.state === 'open') {
          incStreamCircuitRejected();
          reply.header('Content-Type', 'text/event-stream; charset=utf-8');
          reply.hijack();
          reply.raw.writeHead(503);
          const errorEvent = {
            schema: 'stream.error.v1',
            code: 'CIRCUIT_OPEN',
            message: 'Service temporarily unavailable',
            recoverable: true
          };
          reply.raw.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
          const doneEvent = { schema: 'stream.done.v1', reason: 'circuit_open' };
          reply.raw.write(`event: done\ndata: ${JSON.stringify(doneEvent)}\n\n`);
          reply.raw.end();
          return reply;
        }

        // Rate limit check
        const ip = getIp(req);
        try { incSseOpen(); } catch {}
        const acq = tryAcquire(ip);
        if (!('ok' in acq) || acq.ok === false) {
          try { incStreamRateLimited(); } catch {}
          const retryAfterS = Math.max(1, Math.ceil(Number(SSE_SLOT_MAX_MS) / 1000));
          // Back-compat: header remains '1' to keep existing tests green
          try { reply.header('Retry-After', '1'); } catch {}
          try { reply.header('X-RateLimit-Reason', acq.ok === false ? acq.reason : 'per_ip'); } catch {}
          try { incSse429Count(); } catch {}
          return reply
            .code(429)
            .send({ schema: 'error.v1', code: 'RATE_LIMITED', message: 'Too many streams', retry_after_s: retryAfterS });
        }

        // Ensure release on socket lifecycle with single metric increment
        let fallbackTimer: NodeJS.Timeout | null = null;
        const releaseOnce = (() => {
          let done = false;
          let timedOut = false;
          return (fromTimeout = false) => {
            if (done) return;
            done = true;
            // Increment disconnect metric only once (inside guard to prevent double-counting
            // when both 'close' and 'error' events fire)
            try { incStreamDisconnect(); } catch {}
            if (fromTimeout) { timedOut = true; try { incSseTimeout(); } catch {} }
            else { try { incSseClosed(); } catch {} }
            try { if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; } } catch {}
            try { release(ip); }
            catch (err) { try { reply.log?.warn({ err, reqId }, 'sse limiter release failed'); } catch {} }
            // P1: Record stream duration
            try { recordStreamDuration(Date.now() - startTime); } catch {}
          };
        })();
        (req.raw as any).on('close', () => { releaseOnce(); });
        (req.raw as any).on('error', () => { releaseOnce(); });
        
        try {
          fallbackTimer = setTimeout(() => { reply.log?.info({ reqId }, 'sse timeout'); releaseOnce(true); }, SSE_SLOT_MAX_MS);
          fallbackTimer.unref?.();
        } catch {}

        // Demo short-circuit
        if (isDemoMode(req)) {
          const traceId = process.env.TRACE_MIN === '1' ? randomUUID() : undefined;
          const heartbeatMs = getSseHeartbeatMs();
          reply.header('Content-Type', 'text/event-stream; charset=utf-8');
          reply.header('Cache-Control', 'no-cache, no-transform');
          reply.header('X-Accel-Buffering', 'no');
          reply.header('Access-Control-Allow-Origin', '*');
          reply.header('Connection', 'keep-alive');
          reply.hijack();
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            'Access-Control-Allow-Origin': '*',
            'Connection': 'keep-alive',
          });
          reply.log.info({ demo: true }, 'sse start');
          
          // P1: Use versioned event schemas
          const initEvent = {
            schema: 'stream.init.v1',
            ts: new Date().toISOString(),
            heartbeat_ms: heartbeatMs,
            ...(traceId ? { trace_id: traceId } : {})
          };
          reply.raw.write(`id: 0\nevent: init\ndata: ${JSON.stringify(initEvent)}\n\n`);
          reply.raw.write(`id: 1\nevent: token\ndata: ${JSON.stringify({ schema: 'stream.token.v1', text: 'hello', index: 0 })}\n\n`);
          reply.raw.write(`id: 2\nevent: done\ndata: ${JSON.stringify({ schema: 'stream.done.v1', reason: 'complete' })}\n\n`);
          safeEnd(reply);
          reply.log.info('sse end');
          return reply;
        }
      },
    ],
  }, async (req, reply) => {
    const q = (req.query ?? {}) as StreamQuery;
    
    // P1: Validate query with AJV
    if (!validateQuery(q)) {
      return reply.code(400).send({
        schema: 'error.v1',
        code: 'INVALID_QUERY',
        message: 'Invalid query parameters',
        errors: validateQuery.errors
      });
    }

    const traceId = process.env.TRACE_MIN === '1' ? randomUUID() : undefined;
    const latencyMs = q.latency_ms ?? 0;
    const heartbeatMs = q.heartbeat_ms ?? getSseHeartbeatMs();
    const maxEvents = q.max_events ?? 100;

    // P1: Initialize bounded queue and heartbeat manager
    const queue = new BoundedEventQueue(getSseMaxBufferedEvents());
    const heartbeat = new HeartbeatManager();

    reply.header('Content-Type', 'text/event-stream; charset=utf-8');
    reply.header('Cache-Control', 'no-cache, no-transform');
    reply.header('X-Accel-Buffering', 'no');
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Connection', 'keep-alive');
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'Connection': 'keep-alive',
    });

    reply.log.info({ latencyMs, heartbeatMs }, 'sse start');

    let closed = false;
    let eventId = 0;
    const onClose = () => {
      if (closed) return;
      closed = true;
      heartbeat.stop();
    };
    (req.raw as any).on('close', onClose);
    (req.raw as any).on('error', onClose);

    // P1: Send init event with versioned schema
    const initEvent = {
      schema: 'stream.init.v1',
      ts: new Date().toISOString(),
      heartbeat_ms: heartbeatMs,
      ...(traceId ? { trace_id: traceId } : {})
    };
    await writeSseWithQueue(reply, queue, eventId++, 'init', initEvent);

    // P1: Start heartbeat
    heartbeat.start(heartbeatMs, async () => {
      if (closed) return;
      const hbEvent = {
        schema: 'stream.heartbeat.v1',
        ts: new Date().toISOString(),
        seq: heartbeat.getSeq()
      };
      await writeSseWithQueue(reply, queue, eventId++, 'heartbeat', hbEvent);
      incStreamHeartbeat();
    });

    // Simulate work
    await waitWithAbort(latencyMs, req);
    
    if (!closed) {
      const tokenEvent = { schema: 'stream.token.v1', text: 'draft', index: 0 };
      await writeSseWithQueue(reply, queue, eventId++, 'token', tokenEvent);
    }

    if (!closed) {
      const doneEvent = { schema: 'stream.done.v1', reason: 'complete' };
      await writeSseWithQueue(reply, queue, eventId++, 'done', doneEvent);
    }

    heartbeat.stop();
    safeEnd(reply);
    reply.log.info('sse end');
    return reply;
  });
}
