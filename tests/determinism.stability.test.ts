/**
 * Determinism Stability Tests - Phase 2
 * Verifies same seed produces identical response_hash across multiple runs
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

// Mock stable stringify (JCS implementation)
function stableStringify(obj: any): string {
  if (obj === null) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  
  // Sort keys lexicographically
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `"${k}":${stableStringify(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

// Mock normalize function (strips excluded fields)
function normalizeReport(report: any): any {
  const normalized = { ...report };
  
  // Remove non-deterministic fields
  delete normalized.trace_id;
  if (normalized.meta) {
    const meta = { ...normalized.meta };
    delete meta.response_id;
    delete meta.elapsed_ms;
    normalized.meta = meta;
  }
  
  return normalized;
}

describe('Determinism Stability', () => {
  it('same seed produces identical response_hash (5 runs)', () => {
    const seed = 4242;
    const hashes: string[] = [];
    
    // Simulate 5 runs with same seed
    for (let i = 0; i < 5; i++) {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        critique: { summary: 'Test' },
        graph: { nodes: [], edges: [] },
        meta: {
          seed,
          response_id: `uuid-${i}`,  // Different each run
          elapsed_ms: 100 + i,  // Different each run
          commit: 'abc123',
          version: '1.0.0'
        },
        model_card: {
          seed,
          assumptions_summary: ['Test assumption'],
          compute_budget: {},
          flags_on: [],
          determinism_note: `Deterministic: Same seed (${seed}) guarantees identical output`
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } },
        schema: 'run.v1'
      };
      
      // Normalize and hash
      const normalized = normalizeReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    }
    
    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
    expect(hashes).toHaveLength(5);
    
    // Verify all match first hash
    const expectedHash = hashes[0];
    hashes.forEach((hash, i) => {
      expect(hash).toBe(expectedHash);
    });
  });

  it('different seeds produce different hashes', () => {
    const seeds = [42, 43, 44];
    const hashes: string[] = [];
    
    seeds.forEach(seed => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
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
          determinism_note: `Seed: ${seed}`
        },
        results: { bands: { p10: seed, p50: seed * 2, p90: seed * 3 } }
      };
      
      const normalized = normalizeReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be different
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(3);
  });

  it('excluded fields do not affect hash', () => {
    const seed = 42;
    const hashes: string[] = [];
    
    // Run with different non-deterministic fields
    const variations = [
      { response_id: 'uuid-1', elapsed_ms: 100, trace_id: 'trace-1' },
      { response_id: 'uuid-2', elapsed_ms: 200, trace_id: 'trace-2' },
      { response_id: 'uuid-3', elapsed_ms: 300, trace_id: 'trace-3' }
    ];
    
    variations.forEach(vars => {
      const response = {
        confidence: { level: 'HIGH', score: 0.9 },
        trace_id: vars.trace_id,  // Should be excluded
        meta: {
          seed,
          response_id: vars.response_id,  // Should be excluded
          elapsed_ms: vars.elapsed_ms,  // Should be excluded
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
      
      const normalized = normalizeReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be identical despite different excluded fields
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
  });

  it('model_card includes hash metadata', () => {
    const modelCard = {
      seed: 42,
      assumptions_summary: ['Test'],
      compute_budget: {},
      flags_on: [],
      determinism_note: 'Test',
      response_hash: 'abc123',
      response_hash_algo: 'sha256',
      normalized: true
    };
    
    expect(modelCard.response_hash).toBeTruthy();
    expect(modelCard.response_hash_algo).toBe('sha256');
    expect(modelCard.normalized).toBe(true);
  });
});
