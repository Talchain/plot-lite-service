import { describe, test, expect } from 'vitest';
import { makeCacheKey, makeCacheTags, extractKeyFields, canonicalStringify } from '../src/cache/key.js';

describe('Cache Key Generation', () => {
  describe('canonicalStringify', () => {
    test('should handle primitives consistently', () => {
      expect(canonicalStringify(null)).toBe('null');
      expect(canonicalStringify(undefined)).toBe('undefined');
      expect(canonicalStringify(42)).toBe('42');
      expect(canonicalStringify('hello')).toBe('"hello"');
      expect(canonicalStringify(true)).toBe('true');
    });

    test('should sort object keys deterministically', () => {
      const obj1 = { b: 2, a: 1, c: 3 };
      const obj2 = { a: 1, c: 3, b: 2 };
      const obj3 = { c: 3, b: 2, a: 1 };

      const str1 = canonicalStringify(obj1);
      const str2 = canonicalStringify(obj2);
      const str3 = canonicalStringify(obj3);

      expect(str1).toBe(str2);
      expect(str2).toBe(str3);
      expect(str1).toBe('{"a":1,"b":2,"c":3}');
    });

    test('should handle nested objects recursively', () => {
      const obj = {
        outer: {
          z: 26,
          a: { nested: true, value: 42 }
        },
        array: [3, 1, 2]
      };

      const result = canonicalStringify(obj);
      expect(result).toBe('{"array":[3,1,2],"outer":{"a":{"nested":true,"value":42},"z":26}}');
    });

    test('should handle arrays without sorting elements', () => {
      const arr = [3, 1, { b: 2, a: 1 }, 4];
      const result = canonicalStringify(arr);
      expect(result).toBe('[3,1,{"a":1,"b":2},4]');
    });
  });

  describe('makeCacheKey', () => {
    test('should generate consistent keys for identical inputs', () => {
      const input = {
        route: '/test',
        orgId: 'org123',
        userId: 'user456',
        body: { data: 'test' },
        seed: 42
      };

      const key1 = makeCacheKey(input);
      const key2 = makeCacheKey(input);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex
    });

    test('should generate different keys for different inputs', () => {
      const input1 = {
        route: '/test',
        orgId: 'org123',
        body: { data: 'test1' }
      };

      const input2 = {
        route: '/test',
        orgId: 'org123',
        body: { data: 'test2' }
      };

      const key1 = makeCacheKey(input1);
      const key2 = makeCacheKey(input2);

      expect(key1).not.toBe(key2);
    });

    test('should normalize optional fields to null', () => {
      const input1 = {
        route: '/test',
        body: { data: 'test' }
      };

      const input2 = {
        route: '/test',
        orgId: null,
        userId: null,
        body: { data: 'test' },
        seed: null,
        templateId: null,
        policy: null
      };

      const key1 = makeCacheKey(input1);
      const key2 = makeCacheKey(input2);

      expect(key1).toBe(key2);
    });

    test('should be sensitive to route differences', () => {
      const baseInput = {
        orgId: 'org123',
        body: { data: 'test' }
      };

      const key1 = makeCacheKey({ ...baseInput, route: '/draft-flows' });
      const key2 = makeCacheKey({ ...baseInput, route: '/critique' });

      expect(key1).not.toBe(key2);
    });

    test('should be sensitive to org context', () => {
      const baseInput = {
        route: '/test',
        body: { data: 'test' }
      };

      const key1 = makeCacheKey({ ...baseInput, orgId: 'org1' });
      const key2 = makeCacheKey({ ...baseInput, orgId: 'org2' });
      const key3 = makeCacheKey({ ...baseInput }); // no orgId

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    test('should be sensitive to user context', () => {
      const baseInput = {
        route: '/test',
        orgId: 'org123',
        body: { data: 'test' }
      };

      const key1 = makeCacheKey({ ...baseInput, userId: 'user1' });
      const key2 = makeCacheKey({ ...baseInput, userId: 'user2' });
      const key3 = makeCacheKey({ ...baseInput }); // no userId

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });

    test('should include seed in key computation', () => {
      const baseInput = {
        route: '/test',
        body: { data: 'test' }
      };

      const key1 = makeCacheKey({ ...baseInput, seed: 42 });
      const key2 = makeCacheKey({ ...baseInput, seed: 43 });
      const key3 = makeCacheKey({ ...baseInput }); // no seed

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    test('should include templateId in key computation', () => {
      const baseInput = {
        route: '/test',
        body: { data: 'test' }
      };

      const key1 = makeCacheKey({ ...baseInput, templateId: 'template1' });
      const key2 = makeCacheKey({ ...baseInput, templateId: 'template2' });
      const key3 = makeCacheKey({ ...baseInput }); // no templateId

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });

    test('should include policy in key computation', () => {
      const baseInput = {
        route: '/test',
        body: { data: 'test' }
      };

      const key1 = makeCacheKey({ ...baseInput, policy: 'policy1' });
      const key2 = makeCacheKey({ ...baseInput, policy: 'policy2' });
      const key3 = makeCacheKey({ ...baseInput }); // no policy

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  describe('makeCacheTags', () => {
    test('should always include route tag', () => {
      const input = {
        route: '/test',
        body: { data: 'test' }
      };

      const tags = makeCacheTags(input);
      expect(tags).toContain('route:/test');
    });

    test('should include org tag when orgId present', () => {
      const input = {
        route: '/test',
        orgId: 'org123',
        body: { data: 'test' }
      };

      const tags = makeCacheTags(input);
      expect(tags).toContain('route:/test');
      expect(tags).toContain('org:org123');
      expect(tags).toHaveLength(2);
    });

    test('should not include org tag when orgId absent', () => {
      const input = {
        route: '/test',
        body: { data: 'test' }
      };

      const tags = makeCacheTags(input);
      expect(tags).toContain('route:/test');
      expect(tags).toHaveLength(1);
    });

    test('should handle empty orgId', () => {
      const input = {
        route: '/test',
        orgId: '',
        body: { data: 'test' }
      };

      const tags = makeCacheTags(input);
      expect(tags).toContain('route:/test');
      expect(tags).toHaveLength(1); // empty orgId should not create tag
    });
  });

  describe('extractKeyFields', () => {
    test('should extract seed when present as number', () => {
      const body = { seed: 42, other: 'data' };
      const result = extractKeyFields(body);

      expect(result.seed).toBe(42);
    });

    test('should ignore seed when not a number', () => {
      const result1 = extractKeyFields({ seed: '42' });
      const result2 = extractKeyFields({ seed: null });
      const result3 = extractKeyFields({ seed: undefined });
      const result4 = extractKeyFields({});

      expect(result1.seed).toBeUndefined();
      expect(result2.seed).toBeUndefined();
      expect(result3.seed).toBeUndefined();
      expect(result4.seed).toBeUndefined();
    });

    test('should extract templateId when present as string', () => {
      const body = { templateId: 'template123', other: 'data' };
      const result = extractKeyFields(body);

      expect(result.templateId).toBe('template123');
    });

    test('should ignore templateId when not a string', () => {
      const result1 = extractKeyFields({ templateId: 123 });
      const result2 = extractKeyFields({ templateId: null });
      const result3 = extractKeyFields({ templateId: undefined });
      const result4 = extractKeyFields({});

      expect(result1.templateId).toBeUndefined();
      expect(result2.templateId).toBeUndefined();
      expect(result3.templateId).toBeUndefined();
      expect(result4.templateId).toBeUndefined();
    });

    test('should extract policy when present as string', () => {
      const body = { policy: 'strict', other: 'data' };
      const result = extractKeyFields(body);

      expect(result.policy).toBe('strict');
    });

    test('should ignore policy when not a string', () => {
      const result1 = extractKeyFields({ policy: 123 });
      const result2 = extractKeyFields({ policy: null });
      const result3 = extractKeyFields({ policy: undefined });
      const result4 = extractKeyFields({});

      expect(result1.policy).toBeUndefined();
      expect(result2.policy).toBeUndefined();
      expect(result3.policy).toBeUndefined();
      expect(result4.policy).toBeUndefined();
    });

    test('should extract all valid fields together', () => {
      const body = {
        seed: 42,
        templateId: 'template123',
        policy: 'strict',
        other: 'ignored'
      };

      const result = extractKeyFields(body);

      expect(result).toEqual({
        seed: 42,
        templateId: 'template123',
        policy: 'strict'
      });
    });

    test('should handle null/undefined body gracefully', () => {
      expect(extractKeyFields(null)).toEqual({
        seed: undefined,
        templateId: undefined,
        policy: undefined
      });

      expect(extractKeyFields(undefined)).toEqual({
        seed: undefined,
        templateId: undefined,
        policy: undefined
      });
    });
  });
});