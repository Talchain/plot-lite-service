/**
 * JCS (JSON Canonicalization Scheme) RFC 8785 implementation
 * Produces deterministic SHA-256 hash of JSON payloads
 */

import { createHash } from 'node:crypto';

/**
 * Canonicalize JSON according to RFC 8785
 * - Sort object keys lexicographically
 * - No whitespace
 * - Unicode escapes normalized
 */
export function canonicalizeJSON(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'null';
  
  const type = typeof obj;
  
  if (type === 'boolean') return obj ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(obj)) throw new Error('Cannot canonicalize non-finite number');
    // RFC 8785: use minimal representation
    return String(obj);
  }
  if (type === 'string') return JSON.stringify(obj);
  
  if (Array.isArray(obj)) {
    const items = obj.map(item => canonicalizeJSON(item));
    return `[${items.join(',')}]`;
  }
  
  if (type === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map(key => {
      const value = canonicalizeJSON(obj[key]);
      return `${JSON.stringify(key)}:${value}`;
    });
    return `{${pairs.join(',')}}`;
  }
  
  throw new Error(`Cannot canonicalize type: ${type}`);
}

/**
 * Compute SHA-256 hash of canonicalized JSON
 */
export function hashJSON(obj: any): string {
  const canonical = canonicalizeJSON(obj);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Normalize report payload by removing volatile fields before hashing
 * Excludes: trace_id, meta.response_id, meta.elapsed_ms
 */
export function normalizeForHash(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  
  const normalized = { ...payload };
  
  // Remove trace_id at top level
  delete normalized.trace_id;
  
  // Normalize meta if present
  if (normalized.meta && typeof normalized.meta === 'object') {
    const { response_id, elapsed_ms, ...restMeta } = normalized.meta;
    normalized.meta = restMeta;
  }
  
  return normalized;
}

/**
 * Stamp response with deterministic hash
 * Returns response_hash (SHA-256 hex) and normalized flag
 */
export function stampResponseHash(payload: any): { response_hash: string; normalized: true } {
  const normalized = normalizeForHash(payload);
  const hash = hashJSON(normalized);
  return {
    response_hash: hash,
    normalized: true
  };
}
