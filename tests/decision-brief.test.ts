/**
 * Decision Brief Assembly Tests
 *
 * Tests for assembleBrief() — pure function assembling DecisionBriefV1
 * from existing run_bundle response data.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';
import type { DecisionBriefV1 } from '../src/types/decision-brief.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'src', 'fixtures', 'decision-brief');

function loadFixture(name: string): { input: BriefAssemblyInput; expected: Omit<DecisionBriefV1, 'brief_id' | 'created_at'> } {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/**
 * Compare brief against expected, ignoring brief_id and created_at (non-deterministic).
 */
function expectBriefMatches(actual: DecisionBriefV1 | null, expected: Omit<DecisionBriefV1, 'brief_id' | 'created_at'>) {
  expect(actual).not.toBeNull();
  const { brief_id, created_at, ...rest } = actual!;
  expect(brief_id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  expect(created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  expect(rest).toEqual(expected);
}

// =============================================================================
// Golden Fixture Tests
// =============================================================================

describe('assembleBrief — golden fixtures', () => {
  it('assembles correctly from normal response (happy path)', () => {
    const { input, expected } = loadFixture('normal.json');
    const result = assembleBrief(input);
    expectBriefMatches(result, expected);
  });

  it('assembles correctly when M2 unavailable (falls back to M1 headline)', () => {
    const { input, expected } = loadFixture('m2-unavailable.json');
    const result = assembleBrief(input);
    expectBriefMatches(result, expected);
  });

  it('assembles correctly with no fragile edges (robust model)', () => {
    const { input, expected } = loadFixture('no-fragile-edges.json');
    const result = assembleBrief(input);
    expectBriefMatches(result, expected);
  });

  it('assembles correctly for partial analysis with PARTIAL_ANALYSIS warning', () => {
    const { input, expected } = loadFixture('partial-analysis.json');
    const result = assembleBrief(input);
    expectBriefMatches(result, expected);
  });
});

// =============================================================================
// Null Return Cases
// =============================================================================

describe('assembleBrief — null returns', () => {
  const minimalInput: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    meta: { seed_used: '1' },
  };

  it('returns null for failed analysis', () => {
    const result = assembleBrief({ ...minimalInput, analysis_status: 'failed' });
    expect(result).toBeNull();
  });

  it('returns null for blocked analysis', () => {
    const result = assembleBrief({ ...minimalInput, analysis_status: 'blocked' as any });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Headline Resolution
// =============================================================================

describe('assembleBrief — headline fallback chain', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    meta: { seed_used: '1' },
  };

  it('uses M2 narrative_summary when available', () => {
    const result = assembleBrief({
      ...base,
      m1_review: {
        narrative_summary: 'M2 headline text',
        story_headlines: {},
        robustness_explanation: { summary: '', primary_risk: '', stability_factors: [], fragility_factors: [] },
        readiness_rationale: '',
        evidence_enhancements: {},
        bias_findings: [],
        key_assumptions: [],
        decision_quality_prompts: [],
      },
      m1_coaching: {
        story_headlines: {},
        evidence_gaps: [],
        model_critiques: [],
        next_actions: [],
        readiness: 'ready',
        headline_type: 'clear_winner',
        executive_summary: { summary: 'M1 fallback', decision_statement: '', key_qualifier: '', action_implication: '' },
        coaching_version: '1.1.0',
        computed_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(result?.headline).toBe('M2 headline text');
  });

  it('falls back to M1 executive_summary.summary when M2 unavailable', () => {
    const result = assembleBrief({
      ...base,
      m1_coaching: {
        story_headlines: {},
        evidence_gaps: [],
        model_critiques: [],
        next_actions: [],
        readiness: 'ready',
        headline_type: 'clear_winner',
        executive_summary: { summary: 'M1 summary headline', decision_statement: '', key_qualifier: '', action_implication: '' },
        coaching_version: '1.1.0',
        computed_at: '2026-01-01T00:00:00Z',
      },
    });
    expect(result?.headline).toBe('M1 summary headline');
  });

  it('falls back to "Analysis complete" when both M1 and M2 headlines missing', () => {
    const result = assembleBrief(base);
    expect(result?.headline).toBe('Analysis complete');
  });

  it('skips empty/whitespace M2 narrative_summary', () => {
    const result = assembleBrief({
      ...base,
      m1_review: {
        narrative_summary: '   ',
        story_headlines: {},
        robustness_explanation: { summary: '', primary_risk: '', stability_factors: [], fragility_factors: [] },
        readiness_rationale: '',
        evidence_enhancements: {},
        bias_findings: [],
        key_assumptions: [],
        decision_quality_prompts: [],
      },
    });
    expect(result?.headline).toBe('Analysis complete');
  });
});

// =============================================================================
// Options Sorting and Ranking
// =============================================================================

describe('assembleBrief — options', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    meta: { seed_used: '1' },
  };

  it('sorts options by win_probability descending, rank is 1-indexed', () => {
    const result = assembleBrief({
      ...base,
      option_comparison: [
        { option_id: 'c', option_label: 'C', id: 'c', label: 'C', win_probability: 0.1 },
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.6 },
        { option_id: 'b', option_label: 'B', id: 'b', label: 'B', win_probability: 0.3 },
      ] as any[],
    });
    expect(result?.options).toEqual([
      { option_id: 'a', label: 'A', win_probability: 0.6, rank: 1 },
      { option_id: 'b', label: 'B', win_probability: 0.3, rank: 2 },
      { option_id: 'c', label: 'C', win_probability: 0.1, rank: 3 },
    ]);
  });

  it('returns empty options when option_comparison is missing', () => {
    const result = assembleBrief(base);
    expect(result?.options).toEqual([]);
  });

  it('uses option_id as deterministic tie-breaker when win_probability is equal', () => {
    const result = assembleBrief({
      ...base,
      option_comparison: [
        { option_id: 'z_option', option_label: 'Z', id: 'z_option', label: 'Z', win_probability: 0.5 },
        { option_id: 'a_option', option_label: 'A', id: 'a_option', label: 'A', win_probability: 0.5 },
        { option_id: 'm_option', option_label: 'M', id: 'm_option', label: 'M', win_probability: 0.5 },
      ] as any[],
    });
    // Equal probabilities → sorted by option_id ascending
    expect(result?.options.map(o => o.option_id)).toEqual(['a_option', 'm_option', 'z_option']);
    expect(result?.options[0].rank).toBe(1);
    expect(result?.options[2].rank).toBe(3);
  });
});

// =============================================================================
// Top Drivers
// =============================================================================

describe('assembleBrief — top_drivers', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    meta: { seed_used: '1' },
  };

  it('caps top_drivers at 5 (provide 8, verify only top 5 by abs(elasticity))', () => {
    const result = assembleBrief({
      ...base,
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'F1', elasticity: 0.9, direction: 'positive' },
        { factor_id: 'f2', factor_label: 'F2', elasticity: -0.8, direction: 'negative' },
        { factor_id: 'f3', factor_label: 'F3', elasticity: 0.7, direction: 'positive' },
        { factor_id: 'f4', factor_label: 'F4', elasticity: -0.6, direction: 'negative' },
        { factor_id: 'f5', factor_label: 'F5', elasticity: 0.5, direction: 'positive' },
        { factor_id: 'f6', factor_label: 'F6', elasticity: -0.4, direction: 'negative' },
        { factor_id: 'f7', factor_label: 'F7', elasticity: 0.3, direction: 'positive' },
        { factor_id: 'f8', factor_label: 'F8', elasticity: -0.2, direction: 'negative' },
      ] as any[],
    });
    expect(result?.top_drivers).toHaveLength(5);
    expect(result?.top_drivers[0]).toEqual({ factor_label: 'F1', sensitivity: 0.9, direction: 'positive' });
    expect(result?.top_drivers[4]).toEqual({ factor_label: 'F5', sensitivity: 0.5, direction: 'positive' });
  });

  it('returns empty array when factor_sensitivity is missing', () => {
    const result = assembleBrief(base);
    expect(result?.top_drivers).toEqual([]);
  });

  it('uses absolute elasticity for sorting (negative values)', () => {
    const result = assembleBrief({
      ...base,
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Small Positive', elasticity: 0.2, direction: 'positive' },
        { factor_id: 'f2', factor_label: 'Large Negative', elasticity: -0.9, direction: 'negative' },
      ] as any[],
    });
    expect(result?.top_drivers[0].factor_label).toBe('Large Negative');
    expect(result?.top_drivers[0].sensitivity).toBe(0.9);
    expect(result?.top_drivers[0].direction).toBe('negative');
  });
});

// =============================================================================
// Robustness Mapping
// =============================================================================

describe('assembleBrief — robustness mapping', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    meta: { seed_used: '1' },
  };

  it.each([
    ['high', 'robust'],
    ['moderate', 'moderate'],
    ['low', 'fragile'],
    ['very_low', 'fragile'],
  ] as const)('maps robustness level "%s" → "%s"', (input, expected) => {
    const result = assembleBrief({
      ...base,
      robustness: { level: input, fragile_edges: [], robust_edges: [] } as any,
    });
    expect(result?.robustness).toBe(expected);
  });

  it('defaults to "moderate" when robustness level is undefined', () => {
    const result = assembleBrief({
      ...base,
      robustness: { fragile_edges: [], robust_edges: [] } as any,
    });
    expect(result?.robustness).toBe('moderate');
  });

  it('defaults to "moderate" when robustness is not provided', () => {
    const result = assembleBrief(base);
    expect(result?.robustness).toBe('moderate');
  });
});

// =============================================================================
// Warnings
// =============================================================================

describe('assembleBrief — warnings', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    meta: { seed_used: '1' },
  };

  it('caps warnings at 10', () => {
    const critiques = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      code: `WARN_${i}`,
      severity: 'warning' as const,
      message: `Warning ${i}`,
      source: 'validation' as const,
      blocks_analysis: false,
    }));
    const result = assembleBrief({ ...base, critiques });
    expect(result?.warnings).toHaveLength(10);
  });

  it('excludes info-severity critiques', () => {
    const result = assembleBrief({
      ...base,
      critiques: [
        { id: 'c1', code: 'INFO_1', severity: 'info', message: 'Info', source: 'validation', blocks_analysis: false },
        { id: 'c2', code: 'WARN_1', severity: 'warning', message: 'Warning', source: 'validation', blocks_analysis: false },
      ] as any[],
    });
    // M2_UNAVAILABLE + WARN_1 (INFO_1 excluded)
    expect(result?.warnings).toHaveLength(2);
    expect(result?.warnings.find(w => w.code === 'WARN_1')).toBeDefined();
    expect(result?.warnings.find(w => w.code === 'INFO_1')).toBeUndefined();
  });

  it('includes PARTIAL_ANALYSIS warning for partial analysis', () => {
    const result = assembleBrief({ ...base, analysis_status: 'partial' });
    expect(result?.warnings).toContainEqual({
      code: 'PARTIAL_ANALYSIS',
      message: 'Some analysis features were unavailable',
      severity: 'warning',
    });
  });

  it('maps blocker severity to error', () => {
    const result = assembleBrief({
      ...base,
      critiques: [
        { id: 'c1', code: 'BLOCKER_1', severity: 'blocker', message: 'Blocked', source: 'validation', blocks_analysis: true },
      ] as any[],
    });
    const blockerWarning = result?.warnings.find(w => w.code === 'BLOCKER_1');
    expect(blockerWarning?.severity).toBe('error');
  });

  it('includes M2_UNAVAILABLE warning when m1_review is absent', () => {
    const result = assembleBrief(base);
    expect(result?.warnings).toContainEqual({
      code: 'M2_UNAVAILABLE',
      message: 'Decision review was unavailable; brief uses deterministic coaching fallback',
      severity: 'warning',
    });
  });

  it('does not include M2_UNAVAILABLE warning when m1_review is present', () => {
    const result = assembleBrief({
      ...base,
      m1_review: {
        narrative_summary: 'Summary',
        story_headlines: {},
        robustness_explanation: { summary: '', primary_risk: '', stability_factors: [], fragility_factors: [] },
        readiness_rationale: '',
        evidence_enhancements: {},
        bias_findings: [],
        key_assumptions: [],
        decision_quality_prompts: [],
      },
    });
    expect(result?.warnings.find(w => w.code === 'M2_UNAVAILABLE')).toBeUndefined();
  });
});

// =============================================================================
// Missing Optional Fields
// =============================================================================

describe('assembleBrief — missing optional fields', () => {
  it('handles missing factor_sensitivity, fragile_edges, evidence_gaps gracefully', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      meta: { seed_used: '42' },
    });
    expect(result).not.toBeNull();
    expect(result?.top_drivers).toEqual([]);
    expect(result?.key_assumptions).toEqual([]);
    expect(result?.what_would_change).toEqual([]);
    expect(result?.options).toEqual([]);
  });
});

// =============================================================================
// Seed Parsing
// =============================================================================

describe('assembleBrief — seed parsing', () => {
  it('parses seed to number from string', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      meta: { seed_used: '12345' },
    });
    expect(result?.seed).toBe(12345);
    expect(typeof result?.seed).toBe('number');
  });
});

// =============================================================================
// Lineage
// =============================================================================

describe('assembleBrief — lineage', () => {
  it('includes response_hash and config_version in lineage', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      response_hash: 'hash123abc',
      meta: { seed_used: '1' },
    });
    expect(result?.lineage.response_hash).toBe('hash123abc');
    expect(result?.lineage.config_version).toBe('1.0.0');
  });
});

// =============================================================================
// Determinism (brief_id varies, content doesn't)
// =============================================================================

describe('assembleBrief — determinism', () => {
  it('same input produces same content (only brief_id and created_at differ)', () => {
    const input: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.7 },
      ] as any[],
      response_hash: 'det123',
      meta: { seed_used: '42' },
    };

    const result1 = assembleBrief(input)!;
    const result2 = assembleBrief(input)!;

    // brief_id should differ (random UUID)
    expect(result1.brief_id).not.toBe(result2.brief_id);

    // Content should be identical
    const { brief_id: _, created_at: __, ...content1 } = result1;
    const { brief_id: _2, created_at: __2, ...content2 } = result2;
    expect(content1).toEqual(content2);
  });
});

// =============================================================================
// Key Assumptions
// =============================================================================

describe('assembleBrief — key_assumptions', () => {
  it('caps key_assumptions at 10', () => {
    const evidence_gaps = Array.from({ length: 15 }, (_, i) => ({
      factor_id: `f${i}`,
      factor_label: `Factor ${i}`,
      voi_score: 0.5,
      confidence: 0.5,
      confidence_display: '50%',
      confidence_defaulted: false,
      influence: 0.5,
      influence_display: '50%',
      suggestion: `Gather data on Factor ${i}`,
      notes: [],
    }));
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      m1_coaching: {
        story_headlines: {},
        evidence_gaps,
        model_critiques: [],
        next_actions: [],
        readiness: 'ready',
        headline_type: 'clear_winner',
        coaching_version: '1.1.0',
        computed_at: '2026-01-01T00:00:00Z',
      },
      meta: { seed_used: '1' },
    });
    expect(result?.key_assumptions).toHaveLength(10);
  });
});

// =============================================================================
// What Would Change
// =============================================================================

describe('assembleBrief — what_would_change', () => {
  it('caps what_would_change at 10', () => {
    const fragile_edges = Array.from({ length: 15 }, (_, i) => ({
      edge_id: `e${i}`,
      from_id: `n${i}a`,
      to_id: `n${i}b`,
      from_label: `From ${i}`,
      to_label: `To ${i}`,
      switch_probability: 0.1,
      alternative_winner_id: null,
      alternative_winner_label: null,
    }));
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      robustness: { level: 'fragile', fragile_edges, robust_edges: [] } as any,
      meta: { seed_used: '1' },
    });
    expect(result?.what_would_change).toHaveLength(10);
    expect(result?.what_would_change[0]).toBe('From 0 \u2192 To 0');
  });

  it('uses from_id/to_id as fallback when labels missing', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      robustness: {
        level: 'fragile',
        fragile_edges: [{
          edge_id: 'e1',
          from_id: 'node_a',
          to_id: 'node_b',
          from_label: '',
          to_label: '',
          switch_probability: 0.2,
          alternative_winner_id: null,
          alternative_winner_label: null,
        }],
        robust_edges: [],
      } as any,
      meta: { seed_used: '1' },
    });
    expect(result?.what_would_change[0]).toBe('node_a \u2192 node_b');
  });
});
