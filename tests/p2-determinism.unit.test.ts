import { describe, it, expect } from 'vitest';
import { canonicalizeJSON, hashJSON, normalizeForHash, stampResponseHash } from '../src/lib/jcs-hash.js';

describe('P2: Determinism stamp — Unit tests', () => {
  describe('canonicalizeJSON', () => {
    it('sorts object keys lexicographically', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"a":2,"m":3,"z":1}');
    });

    it('handles nested objects', () => {
      const obj = { outer: { z: 1, a: 2 }, top: 3 };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"outer":{"a":2,"z":1},"top":3}');
    });

    it('handles arrays', () => {
      const obj = { items: [3, 1, 2] };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"items":[3,1,2]}');
    });

    it('handles primitives', () => {
      expect(canonicalizeJSON(null)).toBe('null');
      expect(canonicalizeJSON(true)).toBe('true');
      expect(canonicalizeJSON(false)).toBe('false');
      expect(canonicalizeJSON(42)).toBe('42');
      expect(canonicalizeJSON("hello")).toBe('"hello"');
    });
  });

  describe('normalizeForHash', () => {
    it('removes trace_id', () => {
      const payload = { trace_id: 'abc123', data: 'keep' };
      const normalized = normalizeForHash(payload);
      expect(normalized.trace_id).toBeUndefined();
      expect(normalized.data).toBe('keep');
    });

    it('removes meta.response_id and meta.elapsed_ms', () => {
      const payload = {
        meta: { response_id: 'uuid', elapsed_ms: 123, seed: 42 },
        data: 'keep'
      };
      const normalized = normalizeForHash(payload);
      expect(normalized.meta.response_id).toBeUndefined();
      expect(normalized.meta.elapsed_ms).toBeUndefined();
      expect(normalized.meta.seed).toBe(42);
    });

    it('preserves other fields', () => {
      const payload = {
        schema: 'report.v1',
        result: { value: 100 },
        meta: { seed: 1337 }
      };
      const normalized = normalizeForHash(payload);
      expect(normalized.schema).toBe('report.v1');
      expect(normalized.result).toEqual({ value: 100 });
      expect(normalized.meta.seed).toBe(1337);
    });
  });

  describe('stampResponseHash', () => {
    it('returns response_hash and normalized flag', () => {
      const payload = { data: 'test' };
      const stamp = stampResponseHash(payload);
      expect(stamp.response_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(stamp.normalized).toBe(true);
    });

    it('produces same hash for same content', () => {
      const payload1 = { a: 1, b: 2 };
      const payload2 = { b: 2, a: 1 }; // different order
      const hash1 = stampResponseHash(payload1).response_hash;
      const hash2 = stampResponseHash(payload2).response_hash;
      expect(hash1).toBe(hash2);
    });

    it('produces different hash for different content', () => {
      const payload1 = { data: 'test1' };
      const payload2 = { data: 'test2' };
      const hash1 = stampResponseHash(payload1).response_hash;
      const hash2 = stampResponseHash(payload2).response_hash;
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('5× determinism proof', () => {
    it('identical payloads produce single unique hash', () => {
      const template = { template: 'test', seed: 4242, result: { value: 100 } };
      
      const hashes = new Set();
      for (let i = 0; i < 5; i++) {
        // Add volatile fields that should be excluded
        const payload = {
          ...template,
          trace_id: `trace-${i}`,
          meta: {
            seed: 4242,
            response_id: `uuid-${i}`,
            elapsed_ms: 100 + i
          }
        };
        const hash = stampResponseHash(payload).response_hash;
        hashes.add(hash);
      }
      
      expect(hashes.size).toBe(1);
      expect(Array.from(hashes)[0]).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
