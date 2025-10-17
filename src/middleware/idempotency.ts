/**
 * Idempotency middleware (in-memory TTL cache)
 * - Scope: per principal (HMAC'd token or canonicalized IP)
 * - TTL: default 15 minutes
 * - Stores exact status and JSON body for replay
 */
import type { FastifyRequest } from 'fastify';
import { extractPrincipal } from '../lib/token-principal.js';
import { MAX_IDEM_ENTRIES } from '../config/constants.js';

interface Entry {
  status: number;
  body: any;
  expiry: number;
}

const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 15 * 60 * 1000);
const store: Map<string, Entry> = new Map();

function now() { return Date.now(); }

export function makeKey(principal: string, idempKey: string): string {
  return `${principal}::${idempKey}`;
}

export function principalFor(req: FastifyRequest): string {
  // P0.1: Delegate to single source of truth (extractPrincipal)
  return extractPrincipal(req);
}

export function getCached(principal: string, idempKey: string): Entry | null {
  const k = makeKey(principal, idempKey);
  const e = store.get(k);
  if (!e) return null;
  if (e.expiry < now()) { store.delete(k); return null; }
  // Touch for LRU: reinsert to move to end
  try { const tmp = store.get(k)!; store.delete(k); store.set(k, tmp); } catch {}
  return e;
}

export function setCached(principal: string, idempKey: string, status: number, body: any) {
  const k = makeKey(principal, idempKey);
  // Overwrite by delete+set to update recency
  if (store.has(k)) store.delete(k);
  store.set(k, { status, body, expiry: now() + TTL_MS });
  // Enforce capacity by evicting oldest (LRU: Map preserves insertion order)
  while (store.size > MAX_IDEM_ENTRIES) {
    const it = store.keys();
    const oldest = it.next();
    if (!oldest.done) store.delete(oldest.value);
    else break;
  }
}

export function pruneExpired(max = 1000) {
  // Opportunistic prune; bound work
  const t = now();
  let c = 0;
  for (const [k, v] of store) {
    if (v.expiry < t) { store.delete(k); }
    if (++c >= max) break;
  }
}

// Background cleanup: prune expired entries every 60s
setInterval(() => {
  try {
    pruneExpired(500);
  } catch {}
}, 60000).unref();

// Public size accessor for health endpoint
export function getIdemStoreSize(): number {
  return store.size;
}

// Test-only helper
export function __idemSize(): number {
  return store.size;
}
