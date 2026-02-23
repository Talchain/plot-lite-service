/**
 * Tests for pre-analysis review pass.
 *
 * Verifies:
 * - Violations → cards mapping
 * - Deterministic card_id generation
 * - Priority sorting (bytewise)
 * - Truncation (>5 → 5, truncated: true)
 * - Severity → card_type mapping
 */

import { describe, it, expect } from 'vitest';
import { generatePreAnalysisReview } from '../src/review-pass/pre-analysis.js';
import type { ViolationInput } from '../src/review-pass/pre-analysis.js';
import type { ReviewPassEnvelopeV1 } from '../src/review-pass/types.js';

describe('generatePreAnalysisReview', () => {
  it('maps error violations to structural cards with priority 1', () => {
    const violations: ViolationInput[] = [
      { code: 'SCHEMA_VALIDATION_FAILED', severity: 'error', reason: 'Invalid graph schema' },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.review_pass_schema_version).toBe(1);
    expect(result.phase).toBe('pre_analysis');
    expect(result.cards).toHaveLength(1);

    const card = result.cards[0];
    expect(card.card_type).toBe('structural');
    expect(card.priority).toBe(1);
    expect(card.review_phase).toBe('pre_analysis');
    expect(card.what).toBe('Invalid graph schema');
    expect(card.supporting_refs).toHaveLength(1);
    expect(card.supporting_refs[0].kind).toBe('violation');
    expect(card.supporting_refs[0].id).toBe('SCHEMA_VALIDATION_FAILED');
    expect(card.suggested_action).toBe('review');
  });

  it('maps warning violations to warning cards with priority 2', () => {
    const violations: ViolationInput[] = [
      {
        code: 'MISSING_BELIEF_ON_OUTCOME_EDGE',
        severity: 'warning',
        at: { from: 'price', to: 'revenue' },
        suggestion: 'Add belief 0..1 to edges into outcomes',
      },
    ];
    const result = generatePreAnalysisReview(violations);

    const card = result.cards[0];
    expect(card.card_type).toBe('warning');
    expect(card.priority).toBe(2);
    expect(card.why).toBe('Add belief 0..1 to edges into outcomes');
    expect(card.affected_edge_ids).toEqual(['price_revenue']);
    expect(card.suggested_action).toBe('update_belief');
  });

  it('maps info violations to gap cards with priority 3', () => {
    const violations: ViolationInput[] = [
      { code: 'LOW_EDGE_COUNT', severity: 'info', reason: 'Graph has few edges' },
    ];
    const result = generatePreAnalysisReview(violations);

    const card = result.cards[0];
    expect(card.card_type).toBe('gap');
    expect(card.priority).toBe(3);
    expect(card.suggested_action).toBe('add_evidence');
  });

  it('generates deterministic card_id from code + affected nodes', () => {
    const violations: ViolationInput[] = [
      { code: 'DECISION_NO_OUTGOING', severity: 'warning', at: { node: 'decision_1' } },
    ];
    const r1 = generatePreAnalysisReview(violations);
    const r2 = generatePreAnalysisReview(violations);

    expect(r1.cards[0].card_id).toBe(r2.cards[0].card_id);
    expect(r1.cards[0].card_id).toMatch(/^pre_DECISION_NO_OUTGOING_[0-9a-f]{8}$/);
  });

  it('sorts by (priority, card_type, card_id)', () => {
    const violations: ViolationInput[] = [
      { code: 'INFO_1', severity: 'info', reason: 'Info message' },
      { code: 'ERROR_1', severity: 'error', reason: 'Error message' },
      { code: 'WARNING_1', severity: 'warning', reason: 'Warning message' },
      { code: 'ERROR_2', severity: 'error', reason: 'Another error' },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.cards[0].priority).toBe(1); // error
    expect(result.cards[1].priority).toBe(1); // error
    expect(result.cards[2].priority).toBe(2); // warning
    expect(result.cards[3].priority).toBe(3); // info
  });

  it('truncates to max 5 cards and sets truncated=true', () => {
    const violations: ViolationInput[] = Array.from({ length: 8 }, (_, i) => ({
      code: `WARN_${i}`,
      severity: 'warning' as const,
      reason: `Warning ${i}`,
    }));
    const result = generatePreAnalysisReview(violations);

    expect(result.cards).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.total_candidates).toBe(8);
  });

  it('sets truncated=false when <= 5 candidates', () => {
    const violations: ViolationInput[] = [
      { code: 'WARN_0', severity: 'warning', reason: 'Warning 0' },
      { code: 'WARN_1', severity: 'warning', reason: 'Warning 1' },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.cards).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.total_candidates).toBe(2);
  });

  it('handles empty violations array', () => {
    const result = generatePreAnalysisReview([]);

    expect(result.cards).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(result.total_candidates).toBe(0);
    expect(result.phase).toBe('pre_analysis');
  });

  it('extracts affected_node_ids from at.node', () => {
    const violations: ViolationInput[] = [
      {
        code: 'OPTION_NO_OUTGOING',
        severity: 'warning',
        at: { node: 'opt_a' },
        suggestion: 'Add outgoing edges',
      },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.cards[0].affected_node_ids).toEqual(['opt_a']);
  });

  it('extracts affected_node_ids from at.node_id', () => {
    const violations: ViolationInput[] = [
      {
        code: 'FACTOR_HAS_INCOMING_EDGES',
        severity: 'warning',
        at: { node_id: 'factor_1' },
      },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.cards[0].affected_node_ids).toEqual(['factor_1']);
  });

  it('defaults severity to error when not specified', () => {
    const violations: ViolationInput[] = [
      { code: 'UNKNOWN', reason: 'Unknown violation' },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.cards[0].card_type).toBe('structural');
    expect(result.cards[0].priority).toBe(1);
  });

  it('bytewise sort: "challenge" < "gap" < "structural" < "warning"', () => {
    // Same priority, different card_types
    const violations: ViolationInput[] = [
      { code: 'W1', severity: 'warning', reason: 'W' },
      { code: 'E1', severity: 'error', reason: 'E' },
      { code: 'I1', severity: 'info', reason: 'I' },
    ];
    const result = generatePreAnalysisReview(violations);

    // priority 1 (error/structural) < priority 2 (warning) < priority 3 (info/gap)
    expect(result.cards.map((c) => c.card_type)).toEqual(['structural', 'warning', 'gap']);
  });

  it('card_id uses node-only hash (edge IDs do not affect card_id)', () => {
    // Same node, different edges → same card_id
    const v1: ViolationInput[] = [
      { code: 'TEST', severity: 'warning', at: { node: 'n1', from: 'a', to: 'b' } },
    ];
    const v2: ViolationInput[] = [
      { code: 'TEST', severity: 'warning', at: { node: 'n1', from: 'x', to: 'y' } },
    ];
    const r1 = generatePreAnalysisReview(v1);
    const r2 = generatePreAnalysisReview(v2);
    expect(r1.cards[0].card_id).toBe(r2.cards[0].card_id);
  });

  it('violation refs do not require role', () => {
    const violations: ViolationInput[] = [
      { code: 'TEST', severity: 'warning', reason: 'test' },
    ];
    const result = generatePreAnalysisReview(violations);
    const ref = result.cards[0].supporting_refs[0];
    expect(ref.kind).toBe('violation');
    // ViolationRef.role is optional — should be absent
    expect(ref.role).toBeUndefined();
  });

  it('cards include priority_band matching priority', () => {
    const violations: ViolationInput[] = [
      { code: 'E1', severity: 'error', reason: 'Error' },
      { code: 'W1', severity: 'warning', reason: 'Warning' },
      { code: 'I1', severity: 'info', reason: 'Info' },
    ];
    const result = generatePreAnalysisReview(violations);

    expect(result.cards[0].priority_band).toBe('critical'); // priority 1
    expect(result.cards[1].priority_band).toBe('high');     // priority 2
    expect(result.cards[2].priority_band).toBe('medium');   // priority 3
  });

  it('cards include provenance with source=validate', () => {
    const violations: ViolationInput[] = [
      { code: 'MISSING_BELIEF_ON_OUTCOME_EDGE', severity: 'warning', reason: 'test' },
    ];
    const result = generatePreAnalysisReview(violations);
    const card = result.cards[0];

    expect(card.provenance).toEqual({
      source: 'validate',
      origin_id: 'MISSING_BELIEF_ON_OUTCOME_EDGE',
    });
  });
});
