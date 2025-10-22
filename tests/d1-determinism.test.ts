/**
 * D1: Determinism envelope tests
 */
import { describe, it, expect } from 'vitest';
import { canonicalizeJSON, hashResponse, stampResponseHash } from '../src/lib/jcs-hash.js';

describe('D1: JCS Canonicalization', () => {
  describe('canonicalizeJSON', () => {
    it('sorts object keys lexicographically', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"a":2,"m":3,"z":1}');
    });

    it('handles nested objects', () => {
      const obj = { outer: { z: 1, a: 2 } };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"outer":{"a":2,"z":1}}');
    });

    it('handles arrays', () => {
      const obj = { items: [3, 1, 2] };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"items":[3,1,2]}');
    });

    it('omits undefined values', () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"a":1,"c":3}');
    });

    it('converts null to "null"', () => {
      const obj = { value: null };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"value":null}');
    });

    it('handles booleans', () => {
      const obj = { t: true, f: false };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toBe('{"f":false,"t":true}');
    });

    it('handles numbers consistently', () => {
      const obj = { int: 42, float: 3.14, zero: 0 };
      const canonical = canonicalizeJSON(obj);
      expect(canonical).toContain('"int":42');
      expect(canonical).toContain('"float":3.14');
      expect(canonical).toContain('"zero":0');
    });

    it('produces identical output for reordered keys', () => {
      const obj1 = { a: 1, b: 2, c: 3 };
      const obj2 = { c: 3, a: 1, b: 2 };
      
      expect(canonicalizeJSON(obj1)).toBe(canonicalizeJSON(obj2));
    });
  });

  describe('hashResponse', () => {
    it('produces consistent SHA-256 hash', () => {
      const obj = { test: 'value' };
      const hash1 = hashResponse(obj);
      const hash2 = hashResponse(obj);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces same hash for equivalent objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };
      
      expect(hashResponse(obj1)).toBe(hashResponse(obj2));
    });

    it('produces different hash for different objects', () => {
      const obj1 = { value: 1 };
      const obj2 = { value: 2 };
      
      expect(hashResponse(obj1)).not.toBe(hashResponse(obj2));
    });

    it('handles complex nested structures', () => {
      const obj = {
        meta: { seed: 4242, version: 1 },
        data: { nodes: [{ id: 'a' }, { id: 'b' }] }
      };
      
      const hash = hashResponse(obj);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('stampResponseHash', () => {
    it('adds model_card with response_hash', () => {
      const response = { result: 'test' };
      const stamped = stampResponseHash(response);
      
      expect(stamped).toHaveProperty('model_card');
      expect(stamped.model_card).toHaveProperty('response_hash');
      expect(stamped.model_card.response_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('adds response_hash_algo and normalized', () => {
      const response = { result: 'test' };
      const stamped = stampResponseHash(response);
      
      expect(stamped.model_card.response_hash_algo).toBe('sha256');
      expect(stamped.model_card.normalized).toBe(true);
    });

    it('preserves existing model_card fields', () => {
      const response = { 
        result: 'test',
        model_card: { existing: 'field' }
      };
      const stamped = stampResponseHash(response);
      
      expect(stamped.model_card.existing).toBe('field');
      expect(stamped.model_card).toHaveProperty('response_hash');
    });

    it('produces identical hash for 5 identical calls', () => {
      const response = { 
        meta: { seed: 4242 },
        result: { value: 42 }
      };
      
      const hashes = Array.from({ length: 5 }, () => 
        stampResponseHash(response).model_card.response_hash
      );
      
      const unique = new Set(hashes);
      expect(unique.size).toBe(1);
    });

    it('hash is invariant to key order', () => {
      const resp1 = { a: 1, b: 2, c: 3 };
      const resp2 = { c: 3, a: 1, b: 2 };
      
      const hash1 = stampResponseHash(resp1).model_card.response_hash;
      const hash2 = stampResponseHash(resp2).model_card.response_hash;
      
      expect(hash1).toBe(hash2);
    });
  });
});
