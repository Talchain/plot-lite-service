import type { FastifyReply, FastifyRequest } from 'fastify';

export class MonotonicIdGenerator {
  private current = 0;
  next(): number { return this.current++; }
  reset(): void { this.current = 0; }
  current_value(): number { return this.current; }
}

export async function writeSseEvent(
  reply: FastifyReply,
  id: number,
  event: string,
  data: Record<string, any>
): Promise<void> {
  const lines = `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  try {
    const ok = reply.raw.write(lines);
    if (!ok) {
      await new Promise<void>((resolve) => {
        const onDrain = () => { cleanup(); resolve(); };
        const cleanup = () => { try { reply.raw.off?.('drain', onDrain); } catch {} };
        try { reply.raw.once('drain', onDrain); } catch { resolve(); }
      });
    }
  } catch (err: any) {
    if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return;
    throw err;
  }
}

export function writeRetryLine(reply: FastifyReply, retryMs: number = 1500): void {
  try { reply.raw.write(`retry: ${retryMs}\n\n`); } catch {}
}

export function writeHeartbeat(reply: FastifyReply): void {
  try { reply.raw.write(':keepalive\n\n'); } catch {}
}

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  constructor(private reply: FastifyReply, private intervalMs: number = 15000) {}
  start(): void {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => {
      if (!this.stopped) try { writeHeartbeat(this.reply); } catch { this.stop(); }
    }, this.intervalMs);
    this.timer.unref?.();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

export function parseLastEventId(req: FastifyRequest): number | null {
  const header = req.headers['last-event-id'];
  if (!header) return null;
  const parsed = parseInt(String(header), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function setSseSecurityHeaders(reply: FastifyReply): void {
  reply.header('Content-Type', 'text/event-stream; charset=utf-8');
  reply.header('Cache-Control', 'no-store');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Accel-Buffering', 'no');
  reply.header('Connection', 'keep-alive');
}
