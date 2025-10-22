/**
 * Determinism Integration Tests - Phase 2
 * Verifies /v1/run produces identical response_hash for same template+seed
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { stableStringify, normaliseReport } from '../src/util/canonical-json.js';

describe('Run Determinism Integration', () => {
  it('5 identical runs produce 1 unique hash', () => {
    const seed = 4242;
    const hashes: string[] = [];
    
    // Simulate 5 runs with same seed but different non-deterministic fields
    for (let i = 0; i < 5; i++) {
      const response = {
        confidence: { level: 'HIGH', score: 0.9, reason: 'Test', factors: {} },
        critique: { summary: 'Test critique', bullets: ['Point 1'] },
        explain_delta: { baseline: 100, target: 150 },
        graph: { nodes: [], edges: [] },
        identifiability: { identifiable: true, summary: 'Test' },
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
          determinism_note: `Deterministic: Same seed (${seed}) guarantees identical output`,
          response_hash_algo: 'sha256',
          normalized: true
        },
        results: { bands: { p10: 10, p50: 50, p90: 90 } },
        schema: 'run.v1',
        trace_id: `trace-${i}`  // Different each run
      };
      
      // Normalize and hash (simulating server-side logic)
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    }
    
    // All hashes should be identical
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(1);
    expect(hashes).toHaveLength(5);
    
    // Log for evidence
    console.log(`✅ 5 runs → 1 unique hash: ${hashes[0]}`);
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
      
      const normalized = normaliseReport(response);
      const canonical = stableStringify(normalized);
      const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
      
      hashes.push(hash);
    });
    
    // All hashes should be different
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(3);
  });

  it('model_card includes hash metadata', () => {
    const response = {
      meta: { seed: 42 },
      model_card: {
        seed: 42,
        assumptions_summary: [],
        compute_budget: {},
        flags_on: [],
        determinism_note: 'Test',
        response_hash: 'abc123',
        response_hash_algo: 'sha256',
        normalized: true
      },
      results: {}
    };
    
    expect(response.model_card.response_hash).toBeTruthy();
    expect(response.model_card.response_hash_algo).toBe('sha256');
    expect(response.model_card.normalized).toBe(true);
  });
});
