/**
 * Critique Normalization Unit Tests
 * 
 * Verifies that critique is always coerced to array format
 * regardless of input type (null, object, array).
 */

import { describe, it, expect } from 'vitest';
import { normaliseReport } from '../src/util/canonical-json.js';

describe('Critique Normalization', () => {
  it('null critique → empty array', () => {
    const report = { critique: null, schema: 'run.v1' };
    const normalized = normaliseReport(report) as any;
    
    expect(Array.isArray(normalized.critique)).toBe(true);
    expect(normalized.critique).toEqual([]);
  });

  it('undefined critique → empty array', () => {
    const report = { critique: undefined, schema: 'run.v1' };
    const normalized = normaliseReport(report) as any;
    
    expect(Array.isArray(normalized.critique)).toBe(true);
    expect(normalized.critique).toEqual([]);
  });

  it('already-array critique → passthrough', () => {
    const items = [
      { severity: 'HIGH', message: 'test' },
      { severity: 'LOW', message: 'test2' },
    ];
    const report = { critique: items, schema: 'run.v1' };
    const normalized = normaliseReport(report) as any;
    
    expect(Array.isArray(normalized.critique)).toBe(true);
    expect(normalized.critique).toEqual(items);
  });

  it('object with numeric keys → Object.values()', () => {
    const report = {
      critique: {
        '0': { severity: 'HIGH', message: 'first' },
        '1': { severity: 'LOW', message: 'second' },
      },
      schema: 'run.v1',
    };
    const normalized = normaliseReport(report) as any;
    
    expect(Array.isArray(normalized.critique)).toBe(true);
    expect(normalized.critique).toHaveLength(2);
    expect(normalized.critique[0]).toEqual({ severity: 'HIGH', message: 'first' });
    expect(normalized.critique[1]).toEqual({ severity: 'LOW', message: 'second' });
  });

  it('single object → array with one element', () => {
    const report = {
      critique: { severity: 'MEDIUM', message: 'single item' },
      schema: 'run.v1',
    };
    const normalized = normaliseReport(report) as any;
    
    expect(Array.isArray(normalized.critique)).toBe(true);
    expect(normalized.critique).toHaveLength(1);
    expect(normalized.critique[0]).toEqual({ severity: 'MEDIUM', message: 'single item' });
  });

  it('report without critique field → unchanged', () => {
    const report = { schema: 'run.v1', results: {} };
    const normalized = normaliseReport(report) as any;
    
    expect('critique' in normalized).toBe(false);
  });

  it('preserves other fields while normalizing critique', () => {
    const report = {
      schema: 'run.v1',
      critique: { '0': { severity: 'HIGH', message: 'test' } },
      confidence: { level: 'HIGH', score: 0.9 },
      meta: { seed: 42 },
    };
    const normalized = normaliseReport(report) as any;
    
    expect(normalized.schema).toBe('run.v1');
    expect(normalized.confidence).toEqual({ level: 'HIGH', score: 0.9 });
    expect(normalized.meta).toEqual({ seed: 42 });
    expect(Array.isArray(normalized.critique)).toBe(true);
  });
});
