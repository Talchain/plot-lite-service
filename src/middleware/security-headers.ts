import type { FastifyReply, FastifyRequest } from 'fastify';

export async function securityHeadersOnSend(req: FastifyRequest, reply: FastifyReply, payload: any) {
  try {
    const raw: any = reply?.raw;
    if (raw && (raw.headersSent || raw.writableEnded)) return payload;

    const ct = String(reply.getHeader('Content-Type') || '').toLowerCase();
    // Never apply JSON-only headers to SSE; proactively remove if present
    if (ct.startsWith('text/event-stream')) {
      try { reply.removeHeader('X-Content-Type-Options'); } catch {}
      try { reply.removeHeader('Referrer-Policy'); } catch {}
      try { reply.removeHeader('Cache-Control'); } catch {}
      return payload;
    }
    // Only apply to JSON responses
    if (!ct || !ct.includes('application/json')) return payload;
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    
    // Skip Cache-Control override for /v1/limits (allows route-specific caching)
    const url = req.url || '';
    if (!url.startsWith('/v1/limits')) {
      reply.header('Cache-Control', 'no-store');
    }
  } catch (err) {
    console.warn('[security-headers] Failed to apply security headers:', err);
  }
  return payload as any;
}
