/**
 * Unit tests for the categorical integrity detector.
 *
 * Audit context: row C1-A (P0).
 * Covers every detection branch listed in plan §Layer 5.1 plus the
 * one-hot grouping wiring point (synthesised because no live CEE emit).
 */

import { describe, it, expect } from 'vitest';
import { detectCategoricalIssues } from '../src/validation/categorical-detector.js';

// Typed builder helpers — `unknown` matches the route entry shape.
type Opt = { id: string; label: string; interventions: Record<string, unknown> };
const opt = (id: string, interventions: Record<string, unknown>): Opt => ({
  id,
  label: id,
  interventions,
});

describe('detectCategoricalIssues — Rule 1 (value_type: "categorical")', () => {
  it('FIRES on a single factor with value_type:"categorical" and 3+ distinct values', () => {
    const result = detectCategoricalIssues([
      opt('opt_uk', { fac_market: { value: 0, value_type: 'categorical', raw_value: 'UK' } }),
      opt('opt_us', { fac_market: { value: 1, value_type: 'categorical', raw_value: 'US' } }),
      opt('opt_eu', { fac_market: { value: 2, value_type: 'categorical', raw_value: 'EU' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    expect(result.blocked_factors[0].factor_id).toBe('fac_market');
    expect(result.blocked_factors[0].trigger).toBe('value_type_categorical');
    expect(result.blocked_factors[0].distinct_value_count).toBe(3);
  });

  it('BYPASSES rule 1 when factor is binary categorical (≤2 distinct values, encoding_map size ≤2)', () => {
    // CEE may emit value_type:"categorical" on per-category one-hot indicators
    // each with binary {0,1} values. The bypass prevents false positive.
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_market_uk: { value: 1, value_type: 'categorical', raw_value: 'UK' } }),
      opt('opt_b', { fac_market_uk: { value: 0, value_type: 'categorical', raw_value: 'UK' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });
});

describe('detectCategoricalIssues — Rule 2 (encoding_map size ≥ 3)', () => {
  it('FIRES on encoding_map with size 3 (no value_type marker)', () => {
    // Rule 2 fires standalone when encoding_map ≥ 3 even without value_type.
    const map = { uk: 0, us: 1, eu: 2 };
    const result = detectCategoricalIssues([
      opt('opt_uk', { fac_market: { value: 0, encoding_map: map } }),
      opt('opt_us', { fac_market: { value: 1, encoding_map: map } }),
      opt('opt_eu', { fac_market: { value: 2, encoding_map: map } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    expect(result.blocked_factors[0].trigger).toBe('encoding_map_size_3plus');
  });

  it('FIRES on encoding_map size 3 with NO value_type marker (rule 2 alone)', () => {
    const map = { red: 0, green: 1, blue: 2 };
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_colour: { value: 0, encoding_map: map } }),
      opt('opt_b', { fac_colour: { value: 1, encoding_map: map } }),
      opt('opt_c', { fac_colour: { value: 2, encoding_map: map } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    expect(result.blocked_factors[0].trigger).toBe('encoding_map_size_3plus');
  });

  it('BYPASSES rule 2 for encoding_map size 2 (binary categorical e.g. boolean)', () => {
    const map = { true: 1, false: 0 };
    const result = detectCategoricalIssues([
      opt('opt_yes', { fac_flag: { value: 1, encoding_map: map } }),
      opt('opt_no', { fac_flag: { value: 0, encoding_map: map } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });
});

describe('detectCategoricalIssues — Rule 3 (integer-coded 3+ with categorical metadata)', () => {
  it('FIRES on integer 0/1/2 across 3 options + value_type:"categorical"', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_x: { value: 0, value_type: 'categorical' } }),
      opt('opt_b', { fac_x: { value: 1, value_type: 'categorical' } }),
      opt('opt_c', { fac_x: { value: 2, value_type: 'categorical' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    // Rule 1 fires first by precedence; that's fine — same blocker.
    expect(['value_type_categorical', 'integer_coded_3plus_with_categorical_metadata']).toContain(
      result.blocked_factors[0].trigger,
    );
  });

  it('FIRES via rule 3 alone when only metadata is non-numeric raw_value (no value_type)', () => {
    // raw_value is a non-numeric string ⇒ counts as categorical metadata.
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_country: { value: 0, raw_value: 'France' } }),
      opt('opt_b', { fac_country: { value: 1, raw_value: 'Germany' } }),
      opt('opt_c', { fac_country: { value: 2, raw_value: 'Spain' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    expect(result.blocked_factors[0].trigger).toBe('integer_coded_3plus_with_categorical_metadata');
  });

  it('BYPASSES rule 3 when integer values exist but NO categorical metadata (value-shape alone insufficient)', () => {
    // Three options, integer values 1/2/3 — no value_type, no encoding_map,
    // no string raw_value. This shape can legitimately represent ordinal-like
    // numeric data; rule 3 must not fire.
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_count: { value: 1 } }),
      opt('opt_b', { fac_count: { value: 2 } }),
      opt('opt_c', { fac_count: { value: 3 } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('BYPASSES rule 3 when fewer than 3 distinct values', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_x: { value: 0, value_type: 'categorical' } }),
      opt('opt_b', { fac_x: { value: 1, value_type: 'categorical' } }),
      // Only 2 distinct.
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('BYPASSES rule 3 when raw_value IS a numeric string (e.g. "180000")', () => {
    // Numeric string raw_value should not trigger rule 3 — that's display
    // metadata, not a categorical marker.
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_salary: { value: 100000, raw_value: '100000' } }),
      opt('opt_b', { fac_salary: { value: 150000, raw_value: '150000' } }),
      opt('opt_c', { fac_salary: { value: 200000, raw_value: '200000' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });
});

describe('detectCategoricalIssues — pass-through cases (must NOT block)', () => {
  it('Pure binary 0/1 numeric factor passes', () => {
    const result = detectCategoricalIssues([
      opt('opt_yes', { fac_hire: { value: 1 } }),
      opt('opt_no', { fac_hire: { value: 0 } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
    expect(result.stripped_meaningful_fields).toHaveLength(0);
  });

  it('Pure numeric continuous (1.5, 2.7, 3.1) passes', () => {
    const result = detectCategoricalIssues([
      opt('opt_low', { fac_metric: { value: 1.5 } }),
      opt('opt_mid', { fac_metric: { value: 2.7 } }),
      opt('opt_hi', { fac_metric: { value: 3.1 } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('Currency factor with raw_value display string passes (rule 3 numeric-string bypass)', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_salary: { value: 180000, raw_value: '£180,000', source: 'user_specified' } }),
      opt('opt_b', { fac_salary: { value: 0, raw_value: '£0', source: 'user_specified' } }),
    ]);
    // raw_value is a non-numeric string but only 2 distinct values, so rule 3
    // 3+-distinct-values check fails → no block.
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('Three separate per-category factors with binary {0,1} values pass', () => {
    // Properly-decomposed one-hot (CEE prompt-compliant): three factors,
    // each with binary values across options. Each factor only sees 2 values
    // (0 and 1), so no rule fires.
    const result = detectCategoricalIssues([
      opt('opt_uk', { fac_market_uk: { value: 1 }, fac_market_us: { value: 0 }, fac_market_eu: { value: 0 } }),
      opt('opt_us', { fac_market_uk: { value: 0 }, fac_market_us: { value: 1 }, fac_market_eu: { value: 0 } }),
      opt('opt_eu', { fac_market_uk: { value: 0 }, fac_market_us: { value: 0 }, fac_market_eu: { value: 1 } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('Mixed graph: one categorical blocks, others pass', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_market: { value: 0, value_type: 'categorical' }, fac_salary: { value: 100000 } }),
      opt('opt_b', { fac_market: { value: 1, value_type: 'categorical' }, fac_salary: { value: 150000 } }),
      opt('opt_c', { fac_market: { value: 2, value_type: 'categorical' }, fac_salary: { value: 200000 } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    expect(result.blocked_factors[0].factor_id).toBe('fac_market');
    // fac_salary is not in blocked_factors.
    expect(result.blocked_factors.some((b) => b.factor_id === 'fac_salary')).toBe(false);
  });
});

describe('detectCategoricalIssues — ordinal pass condition (vacuous today; reserved for future CEE)', () => {
  it('Explicit type:"ordinal" bypasses block even with 3+ distinct values', () => {
    const result = detectCategoricalIssues([
      opt('opt_low', { fac_severity: { value: 0, type: 'ordinal', value_type: 'categorical' } }),
      opt('opt_mid', { fac_severity: { value: 1, type: 'ordinal', value_type: 'categorical' } }),
      opt('opt_hi', { fac_severity: { value: 2, type: 'ordinal', value_type: 'categorical' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('ordered_categories non-empty bypasses', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_x: { value: 0, value_type: 'categorical', ordered_categories: ['low', 'mid', 'hi'] } }),
      opt('opt_b', { fac_x: { value: 1, value_type: 'categorical', ordered_categories: ['low', 'mid', 'hi'] } }),
      opt('opt_c', { fac_x: { value: 2, value_type: 'categorical', ordered_categories: ['low', 'mid', 'hi'] } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('ordinal_scale: true bypasses', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_x: { value: 0, value_type: 'categorical', ordinal_scale: true } }),
      opt('opt_b', { fac_x: { value: 1, value_type: 'categorical', ordinal_scale: true } }),
      opt('opt_c', { fac_x: { value: 2, value_type: 'categorical', ordinal_scale: true } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });
});

describe('detectCategoricalIssues — one-hot grouping (synthesised; CEE emits no group_id today)', () => {
  it('returns no validated groups when no grouping metadata is present (active block, not no-op)', () => {
    const result = detectCategoricalIssues([
      opt('opt_uk', { fac_market_uk: { value: 1 }, fac_market_us: { value: 0 }, fac_market_eu: { value: 0 } }),
      opt('opt_us', { fac_market_uk: { value: 0 }, fac_market_us: { value: 1 }, fac_market_eu: { value: 0 } }),
    ]);
    expect(result.one_hot_validated_groups).toHaveLength(0);
    expect(result.one_hot_mutex_violations).toHaveLength(0);
  });

  it('validates a clean explicit group (forward-compat for CEE follow-up)', () => {
    const groupTag = 'market_group';
    const result = detectCategoricalIssues([
      opt('opt_uk', {
        fac_market_uk: { value: 1, categorical_group_id: groupTag },
        fac_market_us: { value: 0, categorical_group_id: groupTag },
        fac_market_eu: { value: 0, categorical_group_id: groupTag },
      }),
      opt('opt_us', {
        fac_market_uk: { value: 0, categorical_group_id: groupTag },
        fac_market_us: { value: 1, categorical_group_id: groupTag },
        fac_market_eu: { value: 0, categorical_group_id: groupTag },
      }),
      opt('opt_eu', {
        fac_market_uk: { value: 0, categorical_group_id: groupTag },
        fac_market_us: { value: 0, categorical_group_id: groupTag },
        fac_market_eu: { value: 1, categorical_group_id: groupTag },
      }),
    ]);
    expect(result.one_hot_validated_groups).toHaveLength(1);
    expect(result.one_hot_validated_groups[0].group_id).toBe(groupTag);
    expect(result.one_hot_validated_groups[0].factor_ids.sort()).toEqual(
      ['fac_market_eu', 'fac_market_uk', 'fac_market_us'].sort(),
    );
    expect(result.one_hot_mutex_violations).toHaveLength(0);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('detects mutex violation: option sets 2 indicators to 1', () => {
    const groupTag = 'group_x';
    const result = detectCategoricalIssues([
      opt('opt_bad', {
        fac_a: { value: 1, categorical_group_id: groupTag },
        fac_b: { value: 1, categorical_group_id: groupTag }, // VIOLATION: 2 ones
      }),
      opt('opt_good', {
        fac_a: { value: 0, categorical_group_id: groupTag },
        fac_b: { value: 1, categorical_group_id: groupTag },
      }),
    ]);
    expect(result.one_hot_mutex_violations.length).toBeGreaterThanOrEqual(1);
    const violation = result.one_hot_mutex_violations.find((v) => v.option_id === 'opt_bad');
    expect(violation).toBeDefined();
    expect(violation!.group_id).toBe(groupTag);
    // The whole group fails validation when any option violates → no validated group.
    expect(result.one_hot_validated_groups).toHaveLength(0);
  });

  it('detects mutex violation: option sets 0 indicators to 1', () => {
    const groupTag = 'group_zero';
    const result = detectCategoricalIssues([
      opt('opt_zero', {
        fac_a: { value: 0, categorical_group_id: groupTag },
        fac_b: { value: 0, categorical_group_id: groupTag },
      }),
      opt('opt_good', {
        fac_a: { value: 1, categorical_group_id: groupTag },
        fac_b: { value: 0, categorical_group_id: groupTag },
      }),
    ]);
    expect(result.one_hot_mutex_violations.length).toBeGreaterThanOrEqual(1);
    expect(result.one_hot_mutex_violations.some((v) => v.option_id === 'opt_zero')).toBe(true);
  });

  it('detects mutex violation: non-binary value on indicator', () => {
    const groupTag = 'group_nonbinary';
    const result = detectCategoricalIssues([
      opt('opt_weird', {
        fac_a: { value: 0.5, categorical_group_id: groupTag },
        fac_b: { value: 1, categorical_group_id: groupTag },
      }),
    ]);
    const violation = result.one_hot_mutex_violations.find((v) => v.option_id === 'opt_weird');
    expect(violation).toBeDefined();
    expect(violation!.reason).toMatch(/non-binary/i);
  });
});

describe('detectCategoricalIssues — STRIPPED_FIELD_WARNING trigger narrowing (correction #3)', () => {
  it('value_type triggers warning on a passed-through factor', () => {
    // Binary categorical ({0,1}) bypasses block; value_type metadata still
    // present and dropped by normalisation → warning.
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_flag: { value: 1, value_type: 'boolean' } }),
      opt('opt_b', { fac_flag: { value: 0, value_type: 'boolean' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
    const flagWarnings = result.stripped_meaningful_fields.filter(
      (s) => s.factor_id === 'fac_flag' && s.field === 'value_type',
    );
    expect(flagWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('non-empty encoding_map triggers warning on passed-through factor', () => {
    const map = { true: 1, false: 0 };
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_flag: { value: 1, encoding_map: map } }),
      opt('opt_b', { fac_flag: { value: 0, encoding_map: map } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
    const mapWarnings = result.stripped_meaningful_fields.filter(
      (s) => s.factor_id === 'fac_flag' && s.field === 'encoding_map',
    );
    expect(mapWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('raw_value ALONE (no categorical metadata) does NOT trigger warning — it may be display-only', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_salary: { value: 180000, raw_value: '£180,000' } }),
      opt('opt_b', { fac_salary: { value: 0, raw_value: '£0' } }),
    ]);
    // No value_type, no encoding_map → raw_value strip is silent (display).
    const rawValueStripped = result.stripped_meaningful_fields.filter(
      (s) => s.factor_id === 'fac_salary' && s.field === 'raw_value',
    );
    expect(rawValueStripped).toHaveLength(0);
  });

  it('raw_value WITH value_type:"categorical" triggers warning (paired condition)', () => {
    // Binary categorical bypasses block; raw_value paired with value_type
    // categorical → strip warning emitted.
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_flag: { value: 1, value_type: 'categorical', raw_value: 'true' } }),
      opt('opt_b', { fac_flag: { value: 0, value_type: 'categorical', raw_value: 'false' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
    const rawValueStripped = result.stripped_meaningful_fields.filter(
      (s) => s.factor_id === 'fac_flag' && s.field === 'raw_value',
    );
    expect(rawValueStripped.length).toBeGreaterThanOrEqual(1);
  });

  it('blocked factors do NOT emit STRIPPED_FIELD_WARNING (block is the primary signal)', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_market: { value: 0, value_type: 'categorical', raw_value: 'UK' } }),
      opt('opt_b', { fac_market: { value: 1, value_type: 'categorical', raw_value: 'US' } }),
      opt('opt_c', { fac_market: { value: 2, value_type: 'categorical', raw_value: 'EU' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    // Blocked factor must not appear in stripped_meaningful_fields.
    expect(result.stripped_meaningful_fields.some((s) => s.factor_id === 'fac_market')).toBe(false);
  });
});

describe('detectCategoricalIssues — input narrowing (malformed shapes)', () => {
  it('skips non-object option entries silently', () => {
    const result = detectCategoricalIssues([null, undefined, 'oops', 42]);
    expect(result.blocked_factors).toHaveLength(0);
    expect(result.stripped_meaningful_fields).toHaveLength(0);
  });

  it('skips options without an id', () => {
    const result = detectCategoricalIssues([
      { label: 'no id' } as unknown,
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('skips interventions that are not numbers or objects with .value', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_x: 'not a number' }),
      opt('opt_b', { fac_x: { no_value_field: true } }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });

  it('handles plain-number intervention shape (legacy support)', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_x: 1 }),
      opt('opt_b', { fac_x: 0 }),
    ]);
    expect(result.blocked_factors).toHaveLength(0);
  });
});

describe('detectCategoricalIssues — security: raw user values not in critique-bound output', () => {
  it('raw_values_sample is populated for trace ONLY (consumers must not echo into user_message)', () => {
    const result = detectCategoricalIssues([
      opt('opt_a', { fac_market: { value: 0, value_type: 'categorical', raw_value: 'UK' } }),
      opt('opt_b', { fac_market: { value: 1, value_type: 'categorical', raw_value: 'US' } }),
      opt('opt_c', { fac_market: { value: 2, value_type: 'categorical', raw_value: 'EU' } }),
    ]);
    expect(result.blocked_factors).toHaveLength(1);
    // Sample is populated (trace).
    expect(result.blocked_factors[0].raw_values_sample.length).toBeGreaterThan(0);
    // Sample is bounded (≤5).
    expect(result.blocked_factors[0].raw_values_sample.length).toBeLessThanOrEqual(5);
    // The route-layer test asserts user_message does NOT echo these values
    // (see v2-run.categorical.integration.test.ts).
  });
});
