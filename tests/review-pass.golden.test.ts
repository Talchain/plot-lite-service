/**
 * Golden fixture tests for review pass.
 *
 * Validates that review pass output matches the locked contract in golden fixtures.
 * These tests ensure determinism — same input always produces same output.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePreAnalysisReview } from '../src/review-pass/pre-analysis.js';
import { generatePostAnalysisReview } from '../src/review-pass/post-analysis.js';
import type { ViolationInput } from '../src/review-pass/pre-analysis.js';
import type { FactObjectV1, FactLineage } from '../src/facts/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'review-pass');

const LINEAGE: FactLineage = {
  graph_hash: 'a1b2c3d4e5f6a7b8',
  seed: 4242,
  config_version: '1',
  isl_request_id: 'req-golden-001',
};

describe('pre-analysis golden fixture', () => {
  const golden = JSON.parse(readFileSync(join(FIXTURES_DIR, 'pre-analysis.golden.json'), 'utf8'));
  const violations = golden.input.violations as ViolationInput[];
  const expected = golden.expected;

  it('matches expected card count', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.cards).toHaveLength(expected.card_count);
  });

  it('matches expected truncation', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.truncated).toBe(expected.truncated);
    expect(result.total_candidates).toBe(expected.total_candidates);
  });

  it('matches expected card types', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.cards.map((c) => c.card_type)).toEqual(expected.card_types);
  });

  it('matches expected priorities', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.cards.map((c) => c.priority)).toEqual(expected.priorities);
  });

  it('all card_ids start with "pre_"', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.cards.every((c) => c.card_id.startsWith('pre_'))).toBe(true);
  });

  it('all supporting_refs are kind=violation', () => {
    const result = generatePreAnalysisReview(violations);
    const allViolation = result.cards.every((c) =>
      c.supporting_refs.every((r) => r.kind === 'violation'),
    );
    expect(allViolation).toBe(true);
  });

  it('ordering is stable across multiple runs', () => {
    const r1 = generatePreAnalysisReview(violations);
    const r2 = generatePreAnalysisReview(violations);
    const ids1 = r1.cards.map((c) => c.card_id);
    const ids2 = r2.cards.map((c) => c.card_id);
    expect(ids1).toEqual(ids2);
  });

  it('schema version is 1', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.review_pass_schema_version).toBe(expected.review_pass_schema_version);
  });

  it('phase is pre_analysis', () => {
    const result = generatePreAnalysisReview(violations);
    expect(result.phase).toBe(expected.phase);
  });
});

describe('post-analysis golden fixture', () => {
  const golden = JSON.parse(readFileSync(join(FIXTURES_DIR, 'post-analysis.golden.json'), 'utf8'));
  const expected = golden.expected;

  // Build FactObjectV1[] from the summary
  const facts: FactObjectV1[] = golden.input.facts_summary.fact_types.map((ft: any) => {
    if (ft.type === 'critique') {
      return {
        fact_id: `fact_${ft.id}`,
        fact_key: { type: 'critique', node_id: ft.id, metric: ft.code },
        fact_type: 'critique',
        data: {
          type: 'critique',
          id: ft.id,
          code: ft.code,
          severity: ft.severity,
          message: `Critique: ${ft.code}`,
          suggestion: `Fix ${ft.code}`,
        },
        lineage: LINEAGE,
        content_hash: 'deadbeef12345678',
      } as FactObjectV1;
    }
    return {
      fact_id: `fact_${ft.node_id}`,
      fact_key: { type: 'factor_sensitivity', node_id: ft.node_id, metric: 'sensitivity_score' },
      fact_type: 'factor_sensitivity',
      data: {
        type: 'factor_sensitivity',
        node_id: ft.node_id,
        label: ft.node_id.replace(/_/g, ' '),
        sensitivity_score: 0.85,
        // `importance_score` removed — family-4 slice 0 (2026-07-27).
        importance_rank: ft.importance_rank,
        elasticity: 0.72,
        direction: 'positive',
        confidence: 0.9,
        attribution_stability: ft.attribution_stability,
      },
      lineage: LINEAGE,
      content_hash: 'cafebabe12345678',
    } as FactObjectV1;
  });

  it('matches expected card count', () => {
    const result = generatePostAnalysisReview(facts);
    expect(result.cards).toHaveLength(expected.card_count);
  });

  it('matches expected truncation', () => {
    const result = generatePostAnalysisReview(facts);
    expect(result.truncated).toBe(expected.truncated);
    expect(result.total_candidates).toBe(expected.total_candidates);
  });

  it('all card_ids start with "post_"', () => {
    const result = generatePostAnalysisReview(facts);
    expect(result.cards.every((c) => c.card_id.startsWith('post_'))).toBe(true);
  });

  it('citation roles present match expected', () => {
    const result = generatePostAnalysisReview(facts);
    const roles = new Set(
      result.cards.flatMap((c) => c.supporting_refs.map((r) => r.role)).filter(Boolean),
    );
    for (const expectedRole of expected.citation_roles_present) {
      expect(roles.has(expectedRole)).toBe(true);
    }
  });

  it('priority order matches expected', () => {
    const result = generatePostAnalysisReview(facts);
    expect(result.cards.map((c) => c.priority)).toEqual(expected.priority_order);
  });

  it('ordering is stable across multiple runs', () => {
    const r1 = generatePostAnalysisReview(facts);
    const r2 = generatePostAnalysisReview(facts);
    const ids1 = r1.cards.map((c) => c.card_id);
    const ids2 = r2.cards.map((c) => c.card_id);
    expect(ids1).toEqual(ids2);
  });

  it('schema version is 1', () => {
    const result = generatePostAnalysisReview(facts);
    expect(result.review_pass_schema_version).toBe(expected.review_pass_schema_version);
  });

  it('phase is post_analysis', () => {
    const result = generatePostAnalysisReview(facts);
    expect(result.phase).toBe(expected.phase);
  });
});
