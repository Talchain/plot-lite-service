/**
 * Determinism Exclusions Tests - Phase 2
 * Verifies changing only response_id/elapsed_ms/trace_id doesn't affect hash
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { stableStringify, normaliseReport } from '../src/util/canonical-json.js';

describe('Run Determinism Exclusions', () => {
  it('changing only response_id does not affect hash', () => {
    const seed = 42;
    const hashes: string[] = [];
    
    const responseIds = ['uuid-1', 'uuid-2', 'uuid-3'];
    
    responseIds.forEach(responseId => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        meta: {
          seed,
          response_id: responseId,  // Varies
          commit: 'abc123',
          version: '1.0.0'
        },
        model_card: {
          seed,
          assumptions_summary: ['Test'],
          compute_budget: {},
          flags_on: [],
          determinism_note: 'Test'
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } }
      };
      
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
  });

  it('changing only elapsed_ms does not affect hash', () => {
    const seed = 42;
    const hashes: string[] = [];
    
    const elapsedTimes = [100, 200, 300];
    
    elapsedTimes.forEach(elapsed_ms => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        meta: {
          seed,
          elapsed_ms,  // Varies
          commit: 'abc123',
          version: '1.0.0'
        },
        model_card: {
          seed,
          assumptions_summary: ['Test'],
          compute_budget: {},
          flags_on: [],
          determinism_note: 'Test'
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } }
      };
      
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
  });

  it('changing only trace_id does not affect hash', () => {
    const seed = 42;
    const hashes: string[] = [];
    
    const traceIds = ['trace-1', 'trace-2', 'trace-3'];
    
    traceIds.forEach(trace_id => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        trace_id,  // Varies
        meta: {
          seed,
          commit: 'abc123',
          version: '1.0.0'
        },
        model_card: {
          seed,
          assumptions_summary: ['Test'],
          compute_budget: {},
          flags_on: [],
          determinism_note: 'Test'
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } }
      };
      
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
  });

  it('changing all excluded fields together does not affect hash', () => {
    const seed = 42;
    const hashes: string[] = [];
    
    const variations = [
      { response_id: 'uuid-1', elapsed_ms: 100, trace_id: 'trace-1' },
      { response_id: 'uuid-2', elapsed_ms: 200, trace_id: 'trace-2' },
      { response_id: 'uuid-3', elapsed_ms: 300, trace_id: 'trace-3' }
    ];
    
    variations.forEach(vars => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        trace_id: vars.trace_id,
        meta: {
          seed,
          response_id: vars.response_id,
          elapsed_ms: vars.elapsed_ms,
          commit: 'abc123',
          version: '1.0.0'
        },
        model_card: {
          seed,
          assumptions_summary: ['Test'],
          compute_budget: {},
          flags_on: [],
          determinism_note: 'Test'
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } }
      };
      
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be identical despite all excluded fields varying
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
  });

  it('changing deterministic field (seed) produces different hash', () => {
    const hashes: string[] = [];
    
    [42, 43].forEach(seed => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        trace_id: 'same-trace',  // Same
        meta: {
          seed,  // Different
          response_id: 'same-uuid',  // Same
          elapsed_ms: 100,  // Same
          commit: 'abc123',
          version: '1.0.0'
        },
        model_card: {
          seed,
          assumptions_summary: ['Test'],
          compute_budget: {},
          flags_on: [],
          determinism_note: 'Test'
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } }
      };
      
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // Hashes should be different because seed changed
    expect(hashes[0]).not.toBe(hashes[1]);
  });
});
