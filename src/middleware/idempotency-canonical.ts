import type { FastifyRequest, FastifyReply } from 'fastify';
import { IdempotencyCache, type CachedResponse } from '../lib/idempotency-cache.js';
import { getIdempotencyEnable, getIdempotencyTtlMs, getIdempotencyMaxEntries, getIdempotencyMaxBytes } from '../config/idempotencyConfig.js';
import { canonicalStringify, sha256Hex } from '../util/canonical.js';
import { principalFor, clearInflight } from './idempotency.js';
import { replyWithAppError } from '../errors.js';
import { incIdempotencyHits, incIdempotencyMisses } from '../observability/idempotencyMetrics.js';

interface IdempotencyContext {
  cacheKey: string;
  route: string;
  idempotencyKey: string;
  principal: string;
}

interface MismatchEntry {
  bodyHash: string;
  expiresAt: number;
}

const IDEM_CACHE = new IdempotencyCache(getIdempotencyMaxEntries(), getIdempotencyTtlMs(), getIdempotencyEnable());

const mismatchMap = new Map<string, MismatchEntry>();
let lastCleanup = 0;

function cleanupMismatchMap(now: number, ttlMs: number): void {
  if (now - lastCleanup < ttlMs) return;
  lastCleanup = now;
  for (const [key, entry] of mismatchMap.entries()) {
    if (entry.expiresAt <= now) {
      mismatchMap.delete(key);
    }
  }
}

function getIdempotencyKey(req: FastifyRequest): string | null {
  const headers = req.headers as any;
  const raw = (headers['idempotency-key'] || headers['Idempotency-Key']) as string | undefined;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export async function canonicalIdempotencyPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
  route: string,
): Promise<void | FastifyReply> {
  if (!getIdempotencyEnable()) return;

  const idk = getIdempotencyKey(req);
  if (!idk) return;

  const body: unknown = (req as any).body ?? {};
  const canonical = canonicalStringify(body);
  const bodyHash = sha256Hex(canonical);
  const principal = principalFor(req);

  const now = Date.now();
  const ttlMs = getIdempotencyTtlMs();
  cleanupMismatchMap(now, ttlMs);

  const mismatchKey = `${route}|${principal}|${idk}`;
  const existing = mismatchMap.get(mismatchKey);
  const expiresAt = now + ttlMs;

  if (existing && existing.expiresAt > now && existing.bodyHash !== bodyHash) {
    try {
      clearInflight(principal, idk);
    } catch {}

    return replyWithAppError(reply as any, {
      type: 'IDEMPOTENCY_MISMATCH',
      statusCode: 409,
      message: 'Idempotency-Key was reused with a different request body; use a new key.',
      fields: { code: 'IDEMPOTENCY_MISMATCH', field: 'Idempotency-Key' },
    });
  }

  mismatchMap.set(mismatchKey, { bodyHash, expiresAt });

  IDEM_CACHE.setEnabled(getIdempotencyEnable());

  const cacheKey = IdempotencyCache.generateKey({
    method: String(req.method || 'POST').toUpperCase(),
    path: route,
    principal,
    bodyHash,
    idempotencyKey: idk,
    version: 'v1',
  });

  const cached = IDEM_CACHE.get(cacheKey);
  if (cached) {
    incIdempotencyHits(route);
    (req as any).__idempotent_replay = true;
    try { reply.header('Idempotent-Replayed', '1'); } catch {}
    for (const [name, value] of Object.entries(cached.headers || {})) {
      try { reply.header(name, value); } catch {}
    }
    reply.code(cached.statusCode);
    return reply.send(cached.body);
  }

  incIdempotencyMisses(route);
  (req as any).__idempotent_replay = false;
  (req as any).__idem_v1 = { cacheKey, route, idempotencyKey: idk, principal } as IdempotencyContext;
  try { reply.header('Idempotent-Replayed', '0'); } catch {}
}

export async function canonicalIdempotencyOnSend(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: any,
): Promise<any> {
  const ctx = (req as any).__idem_v1 as IdempotencyContext | undefined;
  if (!ctx) return payload;

  try {
    clearInflight(ctx.principal, ctx.idempotencyKey);
  } catch {}

  let body: any = payload;
  if (typeof payload === 'string') {
    try { body = JSON.parse(payload); } catch { body = null; }
  }

  if (!body || typeof body !== 'object') return payload;

  const status = reply.statusCode || 200;
  if (status < 200 || status >= 300) return payload;

  const raw = JSON.stringify(body);
  const maxBytes = getIdempotencyMaxBytes();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return payload;

  const headers: Record<string, string> = {};
  try {
    const ct = reply.getHeader('Content-Type');
    if (ct) headers['content-type'] = String(ct);
  } catch {}

  const now = Date.now();
  const ttlMs = getIdempotencyTtlMs();

  const cached: CachedResponse = {
    statusCode: status,
    body,
    headers,
    computedAt: now,
    expiresAt: now + ttlMs,
  };

  IDEM_CACHE.set(ctx.cacheKey, cached);
  try { reply.header('Idempotent-Replayed', '0'); } catch {}

  return payload;
}
