/**
 * `decision_brief.defaulted_assumptions[].factor_id` — join key on the
 * factor-scoped disclosure rows.
 *
 * WHY THIS EXISTS. A consumer receiving only `factor_label` must join a
 * producer row back to a canvas node BY LABEL. That join breaks on rename, on
 * duplicate labels, and on every label the consumer's own raw-identifier guard
 * withholds (CEE `sanitiseLabel`, orchestrator-v5/context/enrichment-graph-labels.ts
 * — it returns null for slug-prefixed and UUID-shaped strings, which is exactly
 * what the no-label fallback below produces). `f.factor_id` is already in scope
 * in the emitting loop and already used as the label fallback; emitting it
 * removes the label-join risk class outright.
 *
 * SCOPE — factor-scoped rows ONLY. The run-level `default_disclosure` rows are
 * derived from inference warnings, have no factor, and must NOT gain the key:
 * inventing one there would be a fabricated join target.
 *
 * PURELY ADDITIVE. Every assertion below pins an EXISTING field's value as well
 * as the new key, so a change that moves any current value REDs here rather
 * than passing as "additive".
 *
 * Rows are bound BY IDENTITY (`factor_id`), never by a value predicate another
 * row could satisfy (CLAUDE.md trap 19).
 */

import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

function makeInput(overrides: {
  factor_sensitivity?: unknown[];
  inference_warnings?: Array<{ code: string; message: string; severity: 'info' | 'warning' }>;
} = {}): BriefAssemblyInput {
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: [
      { option_id: 'opt_a', option_label: 'Keep price', id: 'opt_a', label: 'Keep price', win_probability: 0.6 },
      { option_id: 'opt_b', option_label: 'Raise price', id: 'opt_b', label: 'Raise price', win_probability: 0.4 },
    ] as any[],
    robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
    factor_sensitivity: overrides.factor_sensitivity as any,
    inference_warnings: overrides.inference_warnings as any,
    meta: { seed_used: '42' },
  };
}

/** Find a factor-scoped row by its join key — identity binding, never a value predicate. */
function rowById(brief: { defaulted_assumptions?: Array<Record<string, unknown>> }, id: string) {
  const rows = (brief.defaulted_assumptions ?? []).filter((r) => r.factor_id === id);
  expect(rows, `exactly one row for factor_id=${id}`).toHaveLength(1);
  return rows[0] as Record<string, unknown>;
}

describe('defaulted_assumptions[].factor_id — join key', () => {
  it('emits factor_id on a LABELLED value_defaulted row, and leaves every existing field unchanged', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'fac_market_size', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
      ],
    }))!;

    expect(brief.defaulted_assumptions).toHaveLength(1);
    const row = rowById(brief as any, 'fac_market_size');

    // THE NEW KEY
    expect(row.factor_id).toBe('fac_market_size');

    // PURELY ADDITIVE — every pre-existing field pinned at its current value.
    expect(row.factor_label).toBe('Market Size');
    expect(row.source).toBe('value_defaulted');
    expect(row.doctrine).toBe('provisional_doctrine_v0');
    expect(row.note).toBe(
      'No starting value was provided for "Market Size" — the analysis used a default. ' +
        'Setting a real value or range would make this result more trustworthy.',
    );
    // The label is NOT silently replaced by the id.
    expect(row.factor_label).not.toBe(row.factor_id);
  });

  it('emits factor_id on an UNLABELLED row while the label still falls back to the id EXACTLY as today', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'fac_unlabelled', elasticity: 0.4, value_defaulted: true },
        // whitespace-only label takes the same fallback branch
        { factor_id: 'fac_blank_label', factor_label: '   ', elasticity: 0.3, value_defaulted: true },
      ],
    }))!;

    const bare = rowById(brief as any, 'fac_unlabelled');
    expect(bare.factor_id).toBe('fac_unlabelled');
    // UNCHANGED BEHAVIOUR: the label fallback is still the raw id.
    expect(bare.factor_label).toBe('fac_unlabelled');
    expect(bare.note).toContain('"fac_unlabelled"');

    const blank = rowById(brief as any, 'fac_blank_label');
    expect(blank.factor_id).toBe('fac_blank_label');
    expect(blank.factor_label).toBe('fac_blank_label');
  });

  it('binds the join key to ITS OWN row — ids are not cross-assigned', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'fac_alpha', factor_label: 'Alpha Cost', elasticity: 0.5, value_defaulted: true },
        { factor_id: 'fac_beta', factor_label: 'Beta Cost', elasticity: 0.4, value_defaulted: true },
      ],
    }))!;

    expect(rowById(brief as any, 'fac_alpha').factor_label).toBe('Alpha Cost');
    expect(rowById(brief as any, 'fac_beta').factor_label).toBe('Beta Cost');
  });

  it('DUPLICATE LABELS stay distinguishable by factor_id — the risk class this closes', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'fac_cost_a', factor_label: 'Running Cost', elasticity: 0.5, value_defaulted: true },
        { factor_id: 'fac_cost_b', factor_label: 'Running Cost', elasticity: 0.4, value_defaulted: true },
      ],
    }))!;

    const labels = brief.defaulted_assumptions!.map((r) => r.factor_label);
    expect(labels).toEqual(['Running Cost', 'Running Cost']); // ambiguous by label
    const ids = brief.defaulted_assumptions!.map((r) => (r as Record<string, unknown>).factor_id);
    expect(new Set(ids).size, 'ids disambiguate what labels cannot').toBe(2);
  });

  it('run-level default_disclosure rows carry NO factor_id (no factor to join to)', () => {
    const brief = assembleBrief(makeInput({
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', message: 'Root node used a default value', severity: 'info' },
      ],
    }))!;

    const disclosures = brief.defaulted_assumptions!.filter((r) => r.source === 'default_disclosure');
    expect(disclosures).toHaveLength(1);
    const row = disclosures[0] as unknown as Record<string, unknown>;
    expect('factor_id' in row, 'run-level rows must not invent a join target').toBe(false);
    // PURELY ADDITIVE — existing run-level fields unchanged.
    expect(row.factor_label).toBeNull();
    expect(row.code).toBe('ROOT_NODE_DEFAULT_VALUE');
    expect(row.note).toBe('Root node used a default value');
  });

  it('CLAIM SAFETY UNCHANGED: intervention-pinned levers emit no row, and therefore no factor_id', () => {
    const brief = assembleBrief(makeInput({
      factor_sensitivity: [
        { factor_id: 'fac_lever', factor_label: 'Price', elasticity: 0.9, value_defaulted: true, zero_reason: 'intervention_override' },
        { factor_id: 'fac_market_size', factor_label: 'Market Size', elasticity: 0.5, value_defaulted: true },
      ],
    }))!;

    expect(brief.defaulted_assumptions).toHaveLength(1);
    expect(rowById(brief as any, 'fac_market_size').factor_label).toBe('Market Size');
    expect(JSON.stringify(brief.defaulted_assumptions)).not.toContain('fac_lever');
    expect(JSON.stringify(brief.defaulted_assumptions)).not.toContain('Price');
  });
});
