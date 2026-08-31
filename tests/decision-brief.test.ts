/**
 * Decision Brief Assembly Tests
 *
 * Tests for assembleBrief() — pure function assembling DecisionBriefV1
 * from existing run_bundle response data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockLicensedComparison } from './helpers/objective-fixtures.js';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';
import type { DecisionBriefV1 } from '../src/types/decision-brief.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'src', 'fixtures', 'decision-brief');

function loadFixture(name: string): { input: BriefAssemblyInput; expected: Omit<DecisionBriefV1, 'brief_id' | 'created_at'> } {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

/**
 * Compare brief against expected, ignoring brief_id, created_at, and dynamic config_version.
 */
function expectBriefMatches(actual: DecisionBriefV1 | null, expected: Omit<DecisionBriefV1, 'brief_id' | 'created_at'>) {
  expect(actual).not.toBeNull();
  const { brief_id, created_at, ...rest } = actual!;
  expect(brief_id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
  expect(created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
  // config_version is now a dynamic hash — match hex pattern, then substitute for deep equal
  expect(rest.lineage.config_version).toMatch(/^[0-9a-f]{12}$/);
  const expectedWithHash = {
    ...expected,
    lineage: { ...expected.lineage, config_version: rest.lineage.config_version },
  };
  expect(rest).toEqual(expectedWithHash);
}

/** Minimal option_comparison required for non-null brief assembly. */
const MINIMAL_OPTIONS = [
  { option_id: 'opt_a', option_label: 'Option A', id: 'opt_a', label: 'Option A', win_probability: 0.6 },
  { option_id: 'opt_b', option_label: 'Option B', id: 'opt_b', label: 'Option B', win_probability: 0.4 },
] as any[];

// =============================================================================
// Golden Fixture Tests
// =============================================================================

describe('assembleBrief — golden fixtures', () => {
  // Lane PLoT-R3: the golden fixtures pre-date the claim-safe surfaces
  // (headline_banded, defaulted_assumptions, robustness_caveat,
  // warning_codes). Emission is gated behind the default-ON
  // BRIEF_CLAIM_SAFE_SURFACES_ENABLE flag and pinned OFF here so the
  // fixture JSONs stay byte-identical. The new surfaces are covered in
  // tests/decision-brief.claim-safety.test.ts.
  beforeAll(() => {
    process.env.BRIEF_CLAIM_SAFE_SURFACES_ENABLE = '0';
  });
  afterAll(() => {
    delete process.env.BRIEF_CLAIM_SAFE_SURFACES_ENABLE;
  });

  it('assembles correctly from normal response (happy path)', () => {
    const { input, expected } = loadFixture('normal.json');
    const result = assembleBrief(input);
    expectBriefMatches(result, expected);
  });

  it('assembles the licensed headline when M2 is unavailable', () => {
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
    option_comparison: MINIMAL_OPTIONS,
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
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

  it('returns null when option_comparison is missing (incomplete analysis)', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      meta: { seed_used: '1' },
    });
    expect(result).toBeNull();
  });

  it('returns null when option_comparison is empty array', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [],
      meta: { seed_used: '1' },
    });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Headline Resolution
// =============================================================================

describe('assembleBrief — no unlicensed narrative fallback', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: MINIMAL_OPTIONS,
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
    meta: { seed_used: '1' },
  };

  it('does not crown an M2 narrative without objective authority', () => {
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
    expect(result?.headline).toBe('Analysis complete');
  });

  it('does not crown an M1 summary without objective authority', () => {
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
    expect(result?.headline).toBe('Analysis complete');
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
    option_comparison: MINIMAL_OPTIONS,
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
    meta: { seed_used: '1' },
  };

  it('copies producer-ordered options and ranks', () => {
    const input: BriefAssemblyInput = {
      ...base,
      option_comparison: [
        { option_id: 'c', option_label: 'C', id: 'c', label: 'C', win_probability: 0.1 },
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.6 },
        { option_id: 'b', option_label: 'B', id: 'b', label: 'B', win_probability: 0.3 },
      ] as any[],
    };
    input.licensed_comparison = mockLicensedComparison(input.option_comparison!);
    const result = assembleBrief(input);
    expect(result?.options).toEqual([
      { option_id: 'a', label: 'A', win_probability: 0.6, rank: 1 },
      { option_id: 'b', label: 'B', win_probability: 0.3, rank: 2 },
      { option_id: 'c', label: 'C', win_probability: 0.1, rank: 3 },
    ]);
  });

  it('preserves stable producer order and equal dense ranks for ties', () => {
    const input: BriefAssemblyInput = {
      ...base,
      option_comparison: [
        { option_id: 'z_option', option_label: 'Z', id: 'z_option', label: 'Z', win_probability: 0.3 },
        { option_id: 'a_option', option_label: 'A', id: 'a_option', label: 'A', win_probability: 0.3 },
        { option_id: 'm_option', option_label: 'M', id: 'm_option', label: 'M', win_probability: 0.3 },
      ] as any[],
    };
    input.licensed_comparison = mockLicensedComparison(input.option_comparison!);
    const result = assembleBrief(input);
    // Equal probabilities → sorted by option_id ascending
    expect(result?.options.map(o => o.option_id)).toEqual(['a_option', 'm_option', 'z_option']);
    expect(result?.options[0].rank).toBe(1);
    expect(result?.options[2].rank).toBe(1);
  });
});

// =============================================================================
// Top Drivers
// =============================================================================

describe('assembleBrief — top_drivers', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: MINIMAL_OPTIONS,
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
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
    option_comparison: MINIMAL_OPTIONS,
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
    meta: { seed_used: '1' },
  };

  it.each([
    ['high', 'robust'],
    // ISL V2 wire vocabulary is 'medium'; 'moderate' tolerated — the SAME
    // normalisation deriveVerdict applies (robustness-display-verdict.ts).
    ['medium', 'moderate'],
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

  // ROADMAP 2.1248: an ABSENT level used to default to 'moderate' — a
  // fabricated middle value presented as a measured one. Absence now
  // propagates as the honest 'not_assessed' (the same token the sibling
  // robustness.display_verdict already ships for exactly these runs).
  it('HONESTY: absent robustness level → "not_assessed", never a fabricated "moderate"', () => {
    const result = assembleBrief({
      ...base,
      robustness: { fragile_edges: [], robust_edges: [] } as any,
    });
    expect(result?.robustness).toBe('not_assessed');
  });

  it('HONESTY: unrecognised robustness level → "not_assessed", never a fabricated "moderate"', () => {
    const result = assembleBrief({
      ...base,
      robustness: { level: 'some_future_level', fragile_edges: [], robust_edges: [] } as any,
    });
    expect(result?.robustness).toBe('not_assessed');
  });

  it('returns null when robustness is not provided', () => {
    const { robustness: _, ...baseWithoutRobustness } = base;
    const result = assembleBrief(baseWithoutRobustness as any);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Warnings
// =============================================================================

describe('assembleBrief — warnings', () => {
  const base: BriefAssemblyInput = {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: MINIMAL_OPTIONS,
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
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
// Missing Optional Fields (with option_comparison present)
// =============================================================================

describe('assembleBrief — missing optional fields', () => {
  it('handles missing factor_sensitivity, fragile_edges, evidence_gaps gracefully', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      meta: { seed_used: '42' },
    });
    expect(result).not.toBeNull();
    expect(result?.top_drivers).toEqual([]);
    expect(result?.key_assumptions).toEqual([]);
    expect(result?.what_would_change).toEqual([]);
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
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
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
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      response_hash: 'hash123abc',
      meta: { seed_used: '1' },
    });
    expect(result?.lineage.response_hash).toBe('hash123abc');
    expect(result?.lineage.config_version).toMatch(/^[0-9a-f]{12}$/);
  });
});

// =============================================================================
// Determinism (brief_id is deterministic — same inputs → identical brief_id)
// =============================================================================

describe('assembleBrief — determinism', () => {
  it('same input produces identical brief including brief_id', () => {
    const input: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.7 },
      ] as any[],
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      response_hash: 'det123',
      meta: { seed_used: '42' },
    };

    const result1 = assembleBrief(input)!;
    const result2 = assembleBrief(input)!;

    // brief_id should be deterministic (same inputs → same UUID)
    expect(result1.brief_id).toBe(result2.brief_id);
    expect(result1.brief_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // All content except created_at should be identical
    const { created_at: _, ...content1 } = result1;
    const { created_at: _2, ...content2 } = result2;
    expect(content1).toEqual(content2);
  });

  it('brief_id changes when graph_hash changes', () => {
    const base: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.7 },
      ] as any[],
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      response_hash: 'hash_a',
      meta: { seed_used: '42' },
    };

    const result1 = assembleBrief(base)!;
    const result2 = assembleBrief({ ...base, response_hash: 'hash_b' })!;
    expect(result1.brief_id).not.toBe(result2.brief_id);
  });

  it('brief_id changes when seed changes', () => {
    const base: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.7 },
      ] as any[],
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      response_hash: 'hash_a',
      meta: { seed_used: '42' },
    };

    const result1 = assembleBrief(base)!;
    const result2 = assembleBrief({ ...base, meta: { seed_used: '99' } })!;
    expect(result1.brief_id).not.toBe(result2.brief_id);
  });

  it('response_hash is deterministic for same input', () => {
    const input: BriefAssemblyInput = {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'a', option_label: 'A', id: 'a', label: 'A', win_probability: 0.7 },
      ] as any[],
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      response_hash: 'resp_hash_123',
      meta: { seed_used: '42' },
    };

    const result1 = assembleBrief(input)!;
    const result2 = assembleBrief(input)!;
    expect(result1.lineage.response_hash).toBe(result2.lineage.response_hash);
    expect(result1.lineage.response_hash).toBe('resp_hash_123');
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
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
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

  it('returns empty array when evidence_gaps is empty', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      meta: { seed_used: '1' },
    });
    expect(result?.key_assumptions).toEqual([]);
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
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'fragile', fragile_edges, robust_edges: [] } as any,
      meta: { seed_used: '1' },
    });
    expect(result?.what_would_change).toHaveLength(10);
    expect(result?.what_would_change[0]).toBe('From 0 → To 0');
  });

  it('uses from_id/to_id as fallback when labels missing', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
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
    expect(result?.what_would_change[0]).toBe('node_a → node_b');
  });

  it('falls back to factor_sensitivity labels when no fragile edges', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Market Size', elasticity: 0.9, direction: 'positive' },
        { factor_id: 'f2', factor_label: 'Competition', elasticity: -0.7, direction: 'negative' },
      ] as any[],
      meta: { seed_used: '1' },
    });
    expect(result?.what_would_change).toEqual(['Market Size', 'Competition']);
  });

  it('returns empty when no fragile edges and no factor_sensitivity', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      meta: { seed_used: '1' },
    });
    expect(result?.what_would_change).toEqual([]);
  });
});

// =============================================================================
// Missing robustness → null
// =============================================================================

describe('assembleBrief — robustness required', () => {
  it('returns null when robustness is missing (even with option_comparison present)', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      meta: { seed_used: '1' },
    });
    expect(result).toBeNull();
  });
});

// =============================================================================
// Warning dedup and sort
// =============================================================================

describe('assembleBrief — warning dedup and sort', () => {
  it('dedupes warnings on code (keeps first occurrence)', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [
        { id: 'c1', code: 'DUPE_CODE', severity: 'warning', message: 'First occurrence', source: 'validation', blocks_analysis: false },
      ] as any[],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      m1_coaching: {
        story_headlines: {},
        evidence_gaps: [],
        model_critiques: [
          { type: 'DUPE_CODE', severity: 'warning', challenge_question: 'Second occurrence (should be deduped)', suggested_action: '' },
        ],
        next_actions: [],
        readiness: 'ready',
        headline_type: 'clear_winner',
        coaching_version: '1.1.0',
        computed_at: '2026-01-01T00:00:00Z',
      },
      meta: { seed_used: '1' },
    });

    const dupeWarnings = result?.warnings.filter(w => w.code === 'DUPE_CODE');
    expect(dupeWarnings).toHaveLength(1);
    expect(dupeWarnings![0].message).toBe('First occurrence');
  });

  it('sorts warnings by severity desc (error > warning > info) then code bytewise', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [
        { id: 'c1', code: 'Z_WARNING', severity: 'warning', message: 'W1', source: 'validation', blocks_analysis: false },
        { id: 'c2', code: 'A_BLOCKER', severity: 'blocker', message: 'E1', source: 'validation', blocks_analysis: true },
      ] as any[],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      m1_coaching: {
        story_headlines: {},
        evidence_gaps: [],
        model_critiques: [
          { type: 'B_INFO', severity: 'info', challenge_question: 'Info note', suggested_action: '' },
        ],
        next_actions: [],
        readiness: 'ready',
        headline_type: 'clear_winner',
        coaching_version: '1.1.0',
        computed_at: '2026-01-01T00:00:00Z',
      },
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
      meta: { seed_used: '1' },
    });

    // Expected order: error first, then warning, then info
    // A_BLOCKER (error), Z_WARNING (warning), B_INFO (info)
    expect(result?.warnings[0].code).toBe('A_BLOCKER');
    expect(result?.warnings[0].severity).toBe('error');
    expect(result?.warnings[1].code).toBe('Z_WARNING');
    expect(result?.warnings[1].severity).toBe('warning');
    expect(result?.warnings[2].code).toBe('B_INFO');
    expect(result?.warnings[2].severity).toBe('info');
  });
});

// =============================================================================
// Top drivers tie-breaking and direction
// =============================================================================

describe('assembleBrief — top_drivers direction from elasticity sign', () => {
  it('derives direction from sign of elasticity (positive elasticity → positive)', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Factor A', elasticity: 0.5 },
      ] as any[],
      meta: { seed_used: '1' },
    });
    expect(result?.top_drivers[0].direction).toBe('positive');
  });

  it('derives direction from sign of elasticity (negative elasticity → negative)', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      factor_sensitivity: [
        { factor_id: 'f1', factor_label: 'Factor A', elasticity: -0.5 },
      ] as any[],
      meta: { seed_used: '1' },
    });
    expect(result?.top_drivers[0].direction).toBe('negative');
  });

  it('breaks ties by factor_id bytewise ascending', () => {
    const result = assembleBrief({
      analysis_status: 'computed',
      critiques: [],
      option_comparison: MINIMAL_OPTIONS,
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      factor_sensitivity: [
        { factor_id: 'z_factor', factor_label: 'Z', elasticity: 0.5 },
        { factor_id: 'a_factor', factor_label: 'A', elasticity: 0.5 },
        { factor_id: 'm_factor', factor_label: 'M', elasticity: 0.5 },
      ] as any[],
      meta: { seed_used: '1' },
    });
    expect(result?.top_drivers.map(d => d.factor_label)).toEqual(['A', 'M', 'Z']);
  });
});
