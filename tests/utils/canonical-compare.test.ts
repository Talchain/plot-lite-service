/**
 * Tests for canonical comparison utility.
 */

import { describe, it, expect } from 'vitest';
import { canonicalCompare } from './canonical-compare.js';

describe('canonicalCompare', () => {
  it('identical objects → match: true', () => {
    const obj = { a: 1, b: [2, 3], c: { d: 'hello' } };
    const result = canonicalCompare(obj, structuredClone(obj));
    expect(result.match).toBe(true);
    expect(result.diff).toBeUndefined();
  });

  it('differ only in default ignored fields → match: true', () => {
    const actual = {
      value: 42,
      computed_at: '2026-01-01T00:00:00Z',
      processing_time_ms: 150,
      request_id: 'abc-123',
    };
    const expected = {
      value: 42,
      computed_at: '2026-02-15T12:00:00Z',
      processing_time_ms: 999,
      request_id: 'xyz-789',
    };
    const result = canonicalCompare(actual, expected);
    expect(result.match).toBe(true);
  });

  it('real field differs → match: false with path', () => {
    const actual = { a: 1, nested: { deep: 'yes' } };
    const expected = { a: 1, nested: { deep: 'no' } };
    const result = canonicalCompare(actual, expected);
    expect(result.match).toBe(false);
    expect(result.diff).toContain('$.nested.deep');
    expect(result.diff).toContain('"yes"');
    expect(result.diff).toContain('"no"');
  });

  it('arrays in different order, same when sorted → match: true', () => {
    const actual = {
      nodes: [
        { id: 'b', value: 2 },
        { id: 'a', value: 1 },
      ],
    };
    const expected = {
      nodes: [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
    };
    const result = canonicalCompare(actual, expected, {
      sortArraysBy: { '$.nodes': 'id' },
    });
    expect(result.match).toBe(true);
  });

  it('composite sort key with missing field → no crash, deterministic sort', () => {
    const actual = {
      edges: [
        { from: 'b', to: 'c', weight: 1 },
        { from: 'a', weight: 2 }, // missing 'to'
      ],
    };
    const expected = {
      edges: [
        { from: 'a', weight: 2 },
        { from: 'b', to: 'c', weight: 1 },
      ],
    };
    const result = canonicalCompare(actual, expected, {
      sortArraysBy: { '$.edges': 'from::to' },
    });
    expect(result.match).toBe(true);
  });

  it('custom ignoreFields overrides defaults', () => {
    const actual = { value: 42, computed_at: 'A', custom_ts: 'X' };
    const expected = { value: 42, computed_at: 'B', custom_ts: 'Y' };

    // Default ignore includes computed_at but not custom_ts
    const withDefaults = canonicalCompare(actual, expected);
    expect(withDefaults.match).toBe(false);
    expect(withDefaults.diff).toContain('custom_ts');

    // Custom ignore includes custom_ts but not computed_at
    const withCustom = canonicalCompare(actual, expected, {
      ignoreFields: ['custom_ts', 'computed_at'],
    });
    expect(withCustom.match).toBe(true);
  });

  it('function-based sort key', () => {
    const actual = {
      items: [
        { name: 'Charlie', age: 30 },
        { name: 'Alice', age: 25 },
      ],
    };
    const expected = {
      items: [
        { name: 'Alice', age: 25 },
        { name: 'Charlie', age: 30 },
      ],
    };
    const result = canonicalCompare(actual, expected, {
      sortArraysBy: { '$.items': (item: any) => item.name },
    });
    expect(result.match).toBe(true);
  });

  it('array length mismatch → match: false', () => {
    const result = canonicalCompare({ a: [1, 2] }, { a: [1, 2, 3] });
    expect(result.match).toBe(false);
    expect(result.diff).toContain('array length');
  });

  it('missing key → match: false', () => {
    const result = canonicalCompare({ a: 1, b: 2 }, { a: 1 });
    expect(result.match).toBe(false);
    expect(result.diff).toContain('$.b');
  });

  it('type mismatch → match: false', () => {
    const result = canonicalCompare({ a: '1' }, { a: 1 });
    expect(result.match).toBe(false);
    expect(result.diff).toContain('type mismatch');
  });

  it('null vs object → match: false', () => {
    const result = canonicalCompare({ a: null }, { a: {} });
    expect(result.match).toBe(false);
  });

  it('primitives → match: true', () => {
    expect(canonicalCompare(42, 42).match).toBe(true);
    expect(canonicalCompare('hello', 'hello').match).toBe(true);
    expect(canonicalCompare(true, true).match).toBe(true);
  });
});
