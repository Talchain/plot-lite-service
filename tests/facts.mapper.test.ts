/**
 * Unit tests for FactObjectV1 mapper and hash functions.
 *
 * Covers:
 * - fact_id determinism (same inputs → same fact_id)
 * - fact_key sorting (verify stable order)
 * - Empty inputs: no crash, empty facts array
 * - Missing optional fields: graceful handling
 * - Golden fixture validation (computed / partial / failed)
 * - Content hash consistency
 * - assembleFactsFromBundleResults (run_bundle path)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assembleFactObjects,
  assembleFactsFromBundleResults,
  compareFactKeys,
  generateFactId,
  generateContentHash,
  canonicalJson,
  FACTS_SCHEMA_VERSION,
} from '../src/facts/index.js';
import type {
  FactKey,
  FactLineage,
  FactsEnvelope,
  ISLResponseInput,
  BundleResultInput,
} from '../src/facts/index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const LINEAGE: FactLineage = {
  graph_hash: 'a1b2c3d4e5f6a7b8',
  seed: 4242,
  config_version: '1',
  isl_request_id: 'req-test-001',
};

function loadGolden(name: string): any {
  const filePath = resolve(__dirname, '..', 'fixtures', 'facts', `${name}.golden.json`);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// canonicalJson
// ---------------------------------------------------------------------------

describe('canonicalJson', () => {
  it('sorts object keys deterministically', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('handles nested objects', () => {
    const a = { outer: { z: 1, a: 2 } };
    expect(canonicalJson(a)).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves arrays in order', () => {
    const a = { items: [3, 1, 2] };
    expect(canonicalJson(a)).toBe('{"items":[3,1,2]}');
  });

  it('handles null and primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('hello')).toBe('"hello"');
  });
});

// ---------------------------------------------------------------------------
// generateFactId — determinism
// ---------------------------------------------------------------------------

describe('generateFactId', () => {
  it('same inputs produce same fact_id', () => {
    const key: FactKey = { type: 'probability', option_id: 'opt_a' };
    const id1 = generateFactId(key, LINEAGE);
    const id2 = generateFactId(key, LINEAGE);
    expect(id1).toBe(id2);
  });

  it('different keys produce different fact_ids', () => {
    const keyA: FactKey = { type: 'probability', option_id: 'opt_a' };
    const keyB: FactKey = { type: 'probability', option_id: 'opt_b' };
    expect(generateFactId(keyA, LINEAGE)).not.toBe(generateFactId(keyB, LINEAGE));
  });

  it('different lineage produces different fact_ids', () => {
    const key: FactKey = { type: 'probability', option_id: 'opt_a' };
    const lineage2: FactLineage = { ...LINEAGE, seed: 9999 };
    expect(generateFactId(key, LINEAGE)).not.toBe(generateFactId(key, lineage2));
  });

  it('produces 16 hex character string', () => {
    const key: FactKey = { type: 'robustness', metric: 'robustness_score' };
    const id = generateFactId(key, LINEAGE);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// generateContentHash
// ---------------------------------------------------------------------------

describe('generateContentHash', () => {
  it('same data produces same hash', () => {
    const data = { type: 'probability' as const, option_id: 'a', option_label: 'A', p10: 1, p50: 2, p90: 3, mean: 2 };
    expect(generateContentHash(data)).toBe(generateContentHash(data));
  });

  it('different data produces different hash', () => {
    const a = { type: 'probability' as const, option_id: 'a', option_label: 'A', p10: 1, p50: 2, p90: 3, mean: 2 };
    const b = { type: 'probability' as const, option_id: 'b', option_label: 'B', p10: 1, p50: 2, p90: 3, mean: 2 };
    expect(generateContentHash(a)).not.toBe(generateContentHash(b));
  });

  it('produces 16 hex character string', () => {
    const data = { type: 'robustness' as const, robustness_level: 'moderate' as const, robustness_score: 0.5 };
    expect(generateContentHash(data)).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// compareFactKeys — deterministic sort
// ---------------------------------------------------------------------------

describe('compareFactKeys', () => {
  it('sorts by type first', () => {
    const a: FactKey = { type: 'probability' };
    const b: FactKey = { type: 'robustness' };
    expect(compareFactKeys(a, b)).toBeLessThan(0);
  });

  it('sorts by option_id within same type', () => {
    const a: FactKey = { type: 'probability', option_id: 'alpha' };
    const b: FactKey = { type: 'probability', option_id: 'beta' };
    expect(compareFactKeys(a, b)).toBeLessThan(0);
  });

  it('sorts by node_id when option_id matches', () => {
    const a: FactKey = { type: 'factor_sensitivity', node_id: 'a_node' };
    const b: FactKey = { type: 'factor_sensitivity', node_id: 'b_node' };
    expect(compareFactKeys(a, b)).toBeLessThan(0);
  });

  it('identical keys return 0', () => {
    const a: FactKey = { type: 'critique', node_id: 'crit1', metric: 'MISSING' };
    const b: FactKey = { type: 'critique', node_id: 'crit1', metric: 'MISSING' };
    expect(compareFactKeys(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// assembleFactObjects — ISL-style input
// ---------------------------------------------------------------------------

describe('assembleFactObjects', () => {
  it('computed: emits all fact types', () => {
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      options: [
        { option_id: 'opt_a', label: 'A', outcome: { p10: 80, p50: 100, p90: 120, mean: 100 } },
      ],
      factor_sensitivity: [
        { node_id: 'n1', label: 'N1', sensitivity_score: 0.8, importance_rank: 1, direction: 'positive' },
      ],
      critiques: [
        { id: 'c1', code: 'WARN', severity: 'warning', message: 'Test warning' },
      ],
      robustness: { label: 'moderate', score: 0.6 },
    };

    const result = assembleFactObjects(input, LINEAGE);

    expect(result.facts_schema_version).toBe(FACTS_SCHEMA_VERSION);
    expect(result.analysis_status).toBe('computed');
    expect(result.facts.length).toBe(4);

    const types = result.facts.map((f) => f.fact_type);
    expect(types).toContain('probability');
    expect(types).toContain('factor_sensitivity');
    expect(types).toContain('critique');
    expect(types).toContain('robustness');
  });

  it('failed: emits critiques only', () => {
    const input: ISLResponseInput = {
      analysis_status: 'failed',
      options: [{ option_id: 'opt_x', label: 'X', outcome: { p10: 0, p50: 0, p90: 0 } }],
      factor_sensitivity: [{ node_id: 'n1', label: 'N1', sensitivity_score: 0.5, importance_rank: 1 }],
      critiques: [
        { id: 'c1', code: 'BLOCKER', severity: 'blocker', message: 'Blocked' },
      ],
      robustness: { label: 'fragile', score: 0.2 },
    };

    const result = assembleFactObjects(input, LINEAGE);

    expect(result.analysis_status).toBe('failed');
    expect(result.facts.length).toBe(1);
    expect(result.facts[0].fact_type).toBe('critique');
  });

  it('partial: emits critiques + options (no robustness when null)', () => {
    const input: ISLResponseInput = {
      analysis_status: 'partial',
      options: [{ option_id: 'opt_a', label: 'A', outcome: { p10: 50, p50: 70, p90: 90 } }],
      critiques: [{ id: 'c1', code: 'PARTIAL', severity: 'info', message: 'Partial' }],
    };

    const result = assembleFactObjects(input, LINEAGE);

    expect(result.analysis_status).toBe('partial');
    expect(result.facts.length).toBe(2);
    const types = result.facts.map((f) => f.fact_type);
    expect(types).toContain('probability');
    expect(types).toContain('critique');
    expect(types).not.toContain('robustness');
  });

  it('empty inputs: no crash, empty facts array', () => {
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      options: [],
      factor_sensitivity: [],
      critiques: [],
    };

    const result = assembleFactObjects(input, LINEAGE);

    expect(result.facts_schema_version).toBe(1);
    expect(result.facts).toEqual([]);
    expect(result.analysis_status).toBe('computed');
  });

  it('deterministic ordering: same input → same order', () => {
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      options: [
        { option_id: 'opt_b', label: 'B', outcome: { p10: 1, p50: 2, p90: 3 } },
        { option_id: 'opt_a', label: 'A', outcome: { p10: 4, p50: 5, p90: 6 } },
      ],
      critiques: [{ id: 'c1', code: 'WARN', severity: 'warning', message: 'W' }],
    };

    const r1 = assembleFactObjects(input, LINEAGE);
    const r2 = assembleFactObjects(input, LINEAGE);

    expect(r1.facts.map((f) => f.fact_id)).toEqual(r2.facts.map((f) => f.fact_id));
  });

  it('fact_ids are unique within envelope', () => {
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      options: [
        { option_id: 'opt_a', label: 'A', outcome: { p10: 1, p50: 2, p90: 3 } },
        { option_id: 'opt_b', label: 'B', outcome: { p10: 4, p50: 5, p90: 6 } },
      ],
      factor_sensitivity: [
        { node_id: 'n1', label: 'N1', sensitivity_score: 0.8, importance_rank: 1 },
      ],
      critiques: [
        { id: 'c1', code: 'WARN', severity: 'warning', message: 'W' },
      ],
      robustness: { label: 'robust', score: 0.9 },
    };

    const result = assembleFactObjects(input, LINEAGE);
    const ids = result.facts.map((f) => f.fact_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('content_hash present on all facts', () => {
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      options: [{ option_id: 'opt_a', label: 'A', outcome: { p10: 1, p50: 2, p90: 3 } }],
      robustness: { label: 'robust', score: 0.9 },
    };

    const result = assembleFactObjects(input, LINEAGE);
    for (const fact of result.facts) {
      expect(fact.content_hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('limits factor_sensitivity to top 5', () => {
    const factors = Array.from({ length: 10 }, (_, i) => ({
      node_id: `n${i}`,
      label: `Node ${i}`,
      sensitivity_score: 1 - i * 0.1,
      importance_rank: i + 1,
    }));
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      factor_sensitivity: factors,
    };

    const result = assembleFactObjects(input, LINEAGE);
    const sensitivityFacts = result.facts.filter((f) => f.fact_type === 'factor_sensitivity');
    expect(sensitivityFacts.length).toBe(5);
  });

  it('handles missing optional critique fields', () => {
    const input: ISLResponseInput = {
      analysis_status: 'computed',
      critiques: [
        {
          id: 'c1',
          code: 'SIMPLE',
          severity: 'info',
          message: 'Minimal critique',
          // no suggestion, no affected_*
        },
      ],
    };

    const result = assembleFactObjects(input, LINEAGE);
    expect(result.facts.length).toBe(1);
    const data = result.facts[0].data as any;
    expect(data.suggestion).toBeUndefined();
    expect(data.affected_option_ids).toBeUndefined();
    expect(data.affected_node_ids).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assembleFactsFromBundleResults — run_bundle path
// ---------------------------------------------------------------------------

describe('assembleFactsFromBundleResults', () => {
  it('maps successful results to probability facts', () => {
    const results: BundleResultInput[] = [
      { label: 'Low Price', summary: { p10: 80, p50: 100, p90: 120 } },
      { label: 'High Price', summary: { p10: 90, p50: 110, p90: 140 } },
    ];

    const envelope = assembleFactsFromBundleResults(results, LINEAGE);

    expect(envelope.facts_schema_version).toBe(1);
    expect(envelope.analysis_status).toBe('computed');
    expect(envelope.facts.length).toBe(2);
    expect(envelope.facts.every((f) => f.fact_type === 'probability')).toBe(true);
  });

  it('skips errored results', () => {
    const results: BundleResultInput[] = [
      { label: 'Good', summary: { p10: 80, p50: 100, p90: 120 } },
      { label: 'Bad', summary: { p10: 0, p50: 0, p90: 0 }, error: { code: 'FAIL', message: 'failed' } },
    ];

    const envelope = assembleFactsFromBundleResults(results, LINEAGE);

    expect(envelope.analysis_status).toBe('partial');
    expect(envelope.facts.length).toBe(1);
    expect(envelope.facts[0].data).toMatchObject({ option_label: 'Good' });
  });

  it('all errors → failed status', () => {
    const results: BundleResultInput[] = [
      { label: 'A', summary: null, error: { code: 'FAIL', message: 'err' } },
      { label: 'B', summary: null, error: { code: 'FAIL', message: 'err' } },
    ];

    const envelope = assembleFactsFromBundleResults(results, LINEAGE);

    expect(envelope.analysis_status).toBe('failed');
    expect(envelope.facts.length).toBe(0);
  });

  it('empty results → computed with no facts', () => {
    const envelope = assembleFactsFromBundleResults([], LINEAGE);
    expect(envelope.analysis_status).toBe('computed');
    expect(envelope.facts).toEqual([]);
  });

  it('computes mean from p10/p50/p90', () => {
    const results: BundleResultInput[] = [
      { label: 'Test', summary: { p10: 30, p50: 60, p90: 90 } },
    ];

    const envelope = assembleFactsFromBundleResults(results, LINEAGE);
    const data = envelope.facts[0].data as any;
    expect(data.mean).toBe(60); // (30 + 60 + 90) / 3
  });

  it('fact_ids are deterministic across calls', () => {
    const results: BundleResultInput[] = [
      { label: 'A', summary: { p10: 10, p50: 20, p90: 30 } },
    ];

    const e1 = assembleFactsFromBundleResults(results, LINEAGE);
    const e2 = assembleFactsFromBundleResults(results, LINEAGE);

    expect(e1.facts[0].fact_id).toBe(e2.facts[0].fact_id);
    expect(e1.facts[0].content_hash).toBe(e2.facts[0].content_hash);
  });
});

// ---------------------------------------------------------------------------
// Golden fixture validation
// ---------------------------------------------------------------------------

describe('golden fixtures', () => {
  it('computed.golden.json validates', () => {
    const golden = loadGolden('computed');
    const { isl_response, lineage } = golden.input;
    const result = assembleFactObjects(isl_response, lineage);

    expect(result.facts_schema_version).toBe(golden.expected.facts_schema_version);
    expect(result.analysis_status).toBe(golden.expected.analysis_status);
    expect(result.facts.length).toBe(golden.expected.fact_count);

    // Check type distribution
    const typeCounts: Record<string, number> = {};
    for (const fact of result.facts) {
      typeCounts[fact.fact_type] = (typeCounts[fact.fact_type] || 0) + 1;
    }
    expect(typeCounts).toEqual(golden.expected.fact_type_counts);

    // All IDs unique
    const ids = result.facts.map((f) => f.fact_id);
    expect(new Set(ids).size).toBe(ids.length);

    // All content hashes present
    for (const fact of result.facts) {
      expect(fact.content_hash).toMatch(/^[0-9a-f]{16}$/);
    }

    // Ordering stable
    const result2 = assembleFactObjects(isl_response, lineage);
    expect(result.facts.map((f) => f.fact_id)).toEqual(result2.facts.map((f) => f.fact_id));
  });

  it('partial.golden.json validates', () => {
    const golden = loadGolden('partial');
    const { isl_response, lineage } = golden.input;
    const result = assembleFactObjects(isl_response, lineage);

    expect(result.facts_schema_version).toBe(golden.expected.facts_schema_version);
    expect(result.analysis_status).toBe(golden.expected.analysis_status);
    expect(result.facts.length).toBe(golden.expected.fact_count);

    const typeCounts: Record<string, number> = {};
    for (const fact of result.facts) {
      typeCounts[fact.fact_type] = (typeCounts[fact.fact_type] || 0) + 1;
    }
    expect(typeCounts).toEqual(golden.expected.fact_type_counts);
  });

  it('failed.golden.json validates', () => {
    const golden = loadGolden('failed');
    const { isl_response, lineage } = golden.input;
    const result = assembleFactObjects(isl_response, lineage);

    expect(result.facts_schema_version).toBe(golden.expected.facts_schema_version);
    expect(result.analysis_status).toBe(golden.expected.analysis_status);
    expect(result.facts.length).toBe(golden.expected.fact_count);

    // Failed analysis should only have critiques
    for (const fact of result.facts) {
      expect(fact.fact_type).toBe('critique');
    }
  });
});
