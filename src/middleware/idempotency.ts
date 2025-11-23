import type { FastifyRequest } from 'fastify';
import { extractPrincipal } from '../lib/token-principal.js';
import { MAX_IDEM_ENTRIES } from '../config/constants.js';

interface Entry { status: number; body: any; expiry: number; }

const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 15 * 60 * 1000);
const store: Map<string, Entry> = new Map();
const inflight: Set<string> = new Set();

function now() { return Date.now(); }

export function makeKey(principal: string, idempKey: string): string {
  return `${principal}::${idempKey}`;
}

export function principalFor(req: FastifyRequest): string {
  return extractPrincipal(req);
}

export function isInflightOrCached(principal: string, idempKey: string): boolean {
  const k = makeKey(principal, idempKey);
  if (inflight.has(k)) return true;
  return !!getCached(principal, idempKey);
}

export function markInflight(principal: string, idempKey: string): void {
  inflight.add(makeKey(principal, idempKey));
}

export function clearInflight(principal: string, idempKey: string): void {
  inflight.delete(makeKey(principal, idempKey));
}

export function getCached(principal: string, idempKey: string): Entry | null {
  const k = makeKey(principal, idempKey);
  const e = store.get(k);
  if (!e) return null;
  if (e.expiry < now()) { store.delete(k); return null; }
  try { const tmp = store.get(k)!; store.delete(k); store.set(k, tmp); } catch (err) {
    console.warn('[idempotency] Failed to reorder LRU cache entry:', err);
  }
  return e;
}

export function setCached(principal: string, idempKey: string, status: number, body: any) {
  const k = makeKey(principal, idempKey);
  clearInflight(principal, idempKey);
  if (store.has(k)) store.delete(k);
  store.set(k, { status, body, expiry: now() + TTL_MS });
  while (store.size > MAX_IDEM_ENTRIES) {
    const it = store.keys();
    const oldest = it.next();
    if (!oldest.done) store.delete(oldest.value);
    else break;
  }
}

export function pruneExpired(max = 1000) {
  const t = now();
  let c = 0;
  for (const [k, v] of store) {
    if (v.expiry < t) { store.delete(k); }
    if (++c >= max) break;
  }
}

setInterval(() => { try { pruneExpired(500); } catch (err) {
  console.warn('[idempotency] Failed to prune expired entries:', err);
} }, 60000).unref();

export function getIdemStoreSize(): number { return store.size; }
export function __idemSize(): number { return store.size; }
