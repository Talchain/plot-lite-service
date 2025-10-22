/**
 * D1: JCS (RFC 8785) Canonicalization + SHA-256 Hashing
 * Ensures deterministic response hashes
 */
import { createHash } from 'node:crypto';

/**
 * Canonicalize JSON per RFC 8785 (JCS)
 * - Sort keys lexicographically
 * - No whitespace
 * - Consistent number formatting
 */
export function canonicalizeJSON(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'null';
  
  const type = typeof obj;
  
  if (type === 'boolean') return obj ? 'true' : 'false';
  if (type === 'number') {
    if (!isFinite(obj)) throw new Error('Cannot canonicalize non-finite number');
    // Use standard JSON number formatting
    return JSON.stringify(obj);
  }
  if (type === 'string') return JSON.stringify(obj);
  
  if (Array.isArray(obj)) {
    const items = obj.map(item => canonicalizeJSON(item));
    return `[${items.join(',')}]`;
  }
  
  if (type === 'object') {
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter(k => obj[k] !== undefined)  // Omit undefined
      .map(k => `${JSON.stringify(k)}:${canonicalizeJSON(obj[k])}`);
    return `{${pairs.join(',')}}`;
  }
  
  throw new Error(`Cannot canonicalize type: ${type}`);
}

/**
 * Compute SHA-256 hash of canonicalized JSON
 */
export function hashResponse(obj: any): string {
  const canonical = canonicalizeJSON(obj);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Add determinism envelope to response
 */
export function stampResponseHash(response: any): any {
  const hash = hashResponse(response);
  
  return {
    ...response,
    model_card: {
      ...(response.model_card || {}),
      response_hash: hash,
      response_hash_algo: 'sha256',
      normalized: true
    }
  };
}
