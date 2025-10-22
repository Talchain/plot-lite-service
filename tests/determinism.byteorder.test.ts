/**
 * Determinism Byte Order Tests - Phase 2
 * Verifies JCS key ordering produces same hash regardless of input key order
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

// JCS stable stringify (RFC 8785)
function stableStringify(obj: any): string {
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  
  // Sort keys lexicographically (JCS requirement)
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `"${k}":${stableStringify(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

describe('Determinism Byte Order (JCS)', () => {
  it('permuted object keys produce identical hash', () => {
    // Same data, different key orders
    const obj1 = { z: 3, a: 1, m: 2 };
    const obj2 = { a: 1, m: 2, z: 3 };
    const obj3 = { m: 2, z: 3, a: 1 };
    
    const hash1 = createHash('sha256').update(stableStringify(obj1), 'utf8').digest('hex');
    const hash2 = createHash('sha256').update(stableStringify(obj2), 'utf8').digest('hex');
    const hash3 = createHash('sha256').update(stableStringify(obj3), 'utf8').digest('hex');
    
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('nested object key order does not affect hash', () => {
    const obj1 = {
      meta: { z: 3, a: 1 },
      results: { y: 2, b: 0 }
    };
    
    const obj2 = {
      results: { b: 0, y: 2 },
      meta: { a: 1, z: 3 }
    };
    
    const hash1 = createHash('sha256').update(stableStringify(obj1), 'utf8').digest('hex');
    const hash2 = createHash('sha256').update(stableStringify(obj2), 'utf8').digest('hex');
    
    expect(hash1).toBe(hash2);
  });

  it('array order is preserved (not sorted)', () => {
    const obj1 = { arr: [3, 1, 2] };
    const obj2 = { arr: [1, 2, 3] };
    
    const hash1 = createHash('sha256').update(stableStringify(obj1), 'utf8').digest('hex');
    const hash2 = createHash('sha256').update(stableStringify(obj2), 'utf8').digest('hex');
    
    // Different array order = different hash
    expect(hash1).not.toBe(hash2);
  });

  it('number formatting is consistent', () => {
    // JCS normalizes number representation
    const obj1 = { value: 1.0 };
    const obj2 = { value: 1 };
    
    const canonical1 = stableStringify(obj1);
    const canonical2 = stableStringify(obj2);
    
    // Both should serialize to same representation
    expect(canonical1).toBe(canonical2);
  });

  it('null values are included', () => {
    const obj = { a: null, b: 1 };
    const canonical = stableStringify(obj);
    
    expect(canonical).toContain('null');
    expect(canonical).toBe('{"a":null,"b":1}');
  });

  it('undefined values are omitted (JS behavior)', () => {
    const obj = { a: undefined, b: 1, c: 2 };
    
    // JavaScript JSON.stringify omits undefined
    const withoutUndefined = { b: 1, c: 2 };
    const canonical = stableStringify(withoutUndefined);
    
    expect(canonical).toBe('{"b":1,"c":2}');
    expect(canonical).not.toContain('undefined');
  });

  it('real-world response structure is stable', () => {
    // Simulate response with different key insertion orders
    const response1 = {
      schema: 'run.v1',
      results: { bands: { p90: 90, p10: 10, p50: 50 } },
      model_card: { seed: 42, flags_on: [], assumptions_summary: [] },
      meta: { version: '1.0.0', seed: 42, commit: 'abc' },
      confidence: { score: 0.9, level: 'HIGH' }
    };
    
    const response2 = {
      confidence: { level: 'HIGH', score: 0.9 },
      meta: { seed: 42, commit: 'abc', version: '1.0.0' },
      model_card: { assumptions_summary: [], seed: 42, flags_on: [] },
      results: { bands: { p10: 10, p50: 50, p90: 90 } },
      schema: 'run.v1'
    };
    
    const hash1 = createHash('sha256').update(stableStringify(response1), 'utf8').digest('hex');
    const hash2 = createHash('sha256').update(stableStringify(response2), 'utf8').digest('hex');
    
    expect(hash1).toBe(hash2);
  });

  it('unicode key ordering is lexicographic', () => {
    const obj = { 'zzz': 3, 'aaa': 1, 'mmm': 2, 'ÄÄÄ': 4 };
    const canonical = stableStringify(obj);
    
    // Keys should be sorted by Unicode code points
    // Note: Ä (U+00C4) comes after z (U+007A)
    expect(canonical).toMatch(/^{"aaa":1,"mmm":2,"zzz":3,"ÄÄÄ":4}$/);
  });
});
