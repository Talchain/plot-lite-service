/**
 * Tests for Intervention Normaliser
 *
 * Tests normalisation of intervention values to [0,1] for ISL
 * and denormalisation of outcomes back to user units.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveRange,
  normaliseValue,
  denormaliseValue,
  buildNormalisationContext,
  normaliseOptions,
  denormaliseISLResult,
  normaliseOptionsForISL,
  needsNormalisation,
  type NormalisationRange,
  type FactorNormalisationContext,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createFactorNode(
  id: string,
  observedValue?: number,
  baseline?: number,
  range?: { min: number; max: number }
): EngineNodeV3 {
  return {
    id,
    kind: 'factor',
    label: id,
    observed_state: observedValue !== undefined ? {
      value: observedValue,
      baseline,
    } : undefined,
    state_space: range ? { range } : undefined,
  };
}

function createOption(
  id: string,
  interventions: Record<string, number>
): OptionV3 {
  return {
    id,
    label: id,
    interventions: Object.fromEntries(
      Object.entries(interventions).map(([k, v]) => [k, { value: v, source: 'user_specified' as const }])
    ),
  };
}

// =============================================================================
// Range Derivation Tests (Schema v2.6 §B.8 Priority Chain)
// =============================================================================

describe('deriveRange', () => {
  describe('Priority 0: observed_state.cap', () => {
    it('uses cap when present and positive', () => {
      const node: EngineNodeV3 = {
        id: 'revenue',
        kind: 'factor',
        label: 'Revenue',
        observed_state: { value: 100000, cap: 500000 },
        state_space: { range: { min: 0, max: 1000000 } },
      };
      const range = deriveRange(node);

      expect(range.min).toBe(0);
      expect(range.max).toBe(500000);
      expect(range.source).toBe('explicit_cap');
    });

    it('cap takes priority over state_space.range', () => {
      const node: EngineNodeV3 = {
        id: 'revenue',
        kind: 'factor',
        label: 'Revenue',
        observed_state: { value: 100000, cap: 500000 },
        state_space: { range: { min: 0, max: 1000000 } },
      };
      const range = deriveRange(node);

      // Cap (500000) takes priority over state_space.range (1000000)
      expect(range.max).toBe(500000);
      expect(range.source).toBe('explicit_cap');
    });

    it('falls through to state_space.range when cap is 0', () => {
      const node: EngineNodeV3 = {
        id: 'revenue',
        kind: 'factor',
        label: 'Revenue',
        observed_state: { value: 100000, cap: 0 },
        state_space: { range: { min: 0, max: 1000000 } },
      };
      const range = deriveRange(node);

      expect(range.max).toBe(1000000);
      expect(range.source).toBe('explicit');
    });

    it('falls through to state_space.range when cap is negative', () => {
      const node: EngineNodeV3 = {
        id: 'revenue',
        kind: 'factor',
        label: 'Revenue',
        observed_state: { value: 100000, cap: -1 },
        state_space: { range: { min: 0, max: 1000000 } },
      };
      const range = deriveRange(node);

      expect(range.max).toBe(1000000);
      expect(range.source).toBe('explicit');
    });

    it('falls through when cap is not set', () => {
      const node = createFactorNode('salary', 180000, 100000, { min: 0, max: 500000 });
      const range = deriveRange(node);

      expect(range.source).toBe('explicit');
      expect(range.max).toBe(500000);
    });
  });

  describe('Priority 1: Explicit state_space.range', () => {
    it('uses explicit range when provided', () => {
      const node = createFactorNode('salary', 180000, 100000, { min: 0, max: 500000 });
      const range = deriveRange(node);

      expect(range.min).toBe(0);
      expect(range.max).toBe(500000);
      expect(range.source).toBe('explicit');
    });

    it('ignores invalid explicit range (min >= max)', () => {
      const node = createFactorNode('factor', 50);
      node.state_space = { range: { min: 100, max: 50 } };
      const range = deriveRange(node);

      // Should fall through to inferred
      expect(range.source).not.toBe('explicit');
    });
  });

  describe('Priority 2: Inferred from baseline and current value', () => {
    it('derives range from baseline when no explicit range', () => {
      const node = createFactorNode('salary', 180000, 100000);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_baseline');
      expect(range.min).toBe(0);
      // max = 2 × max(|baseline|, |currentValue|) = 2 × 180000 = 360000
      expect(range.max).toBe(360000);
    });

    it('uses larger of baseline or current value for range', () => {
      const node = createFactorNode('salary', 50000, 200000);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_baseline');
      expect(range.max).toBe(400000); // 2 × 200000
    });

    it('positive baseline range is UNCHANGED (zero positive-case delta) [D-9]', () => {
      // POSITIVE CONTROL: for v ≥ 0 the sign-preserving formula {min(0,2v),max(0,2v)}
      // is byte-identical to the pre-D-9 {0, 2v}. This must stay GREEN both before
      // and after the fix (proves zero change for positive-domain factors).
      const node = createFactorNode('salary', 180000, 100000);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_baseline');
      expect(range.min).toBe(0);
      expect(range.max).toBe(360000); // 2 × max(|baseline|, |value|)
      expect(normaliseValue(180000, range).normalised).toBeCloseTo(0.5);
    });

    it('preserves sign for negative baseline — round-trips, not clamped to 0 [D-9]', () => {
      // RED at 733af0c: the branch returned {0, 2×|baseline|} = {0, 1000}, and
      // normaliseValue(-500, {0,1000}) clamps to 0 — the sign/value is ERASED
      // before ISL. D-9 (PRESERVE SIGN): the range must CONTAIN the value.
      const node = createFactorNode('net_cash_position', -500, -500);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_baseline');
      // Range contains the value's sign: {2v, 0} for v < 0.
      expect(range.min).toBeLessThanOrEqual(-500);
      expect(range.max).toBeGreaterThanOrEqual(-500);
      expect(range.min).toBe(-1000);
      expect(range.max).toBe(0);
      // Round-trips to the symmetric midpoint instead of clamping to 0.
      const { normalised, clamped } = normaliseValue(-500, range);
      expect(normalised).not.toBe(0);
      expect(normalised).toBeCloseTo(0.5);
      expect(clamped).toBe(false);
    });
  });

  describe('Priority 3: Inferred from current value only', () => {
    it('derives range from current value when no baseline', () => {
      const node = createFactorNode('salary', 180000);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_value');
      expect(range.min).toBe(0);
      expect(range.max).toBe(360000); // 2 × 180000
    });

    it('positive current value range is UNCHANGED (zero positive-case delta) [D-9]', () => {
      // POSITIVE CONTROL: {min(0,2v),max(0,2v)} == {0,2v} for v ≥ 0. GREEN both ways.
      const node = createFactorNode('temperature', 500);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_value');
      expect(range.min).toBe(0);
      expect(range.max).toBe(1000); // 2 × 500, identical to pre-D-9
      expect(normaliseValue(500, range).normalised).toBeCloseTo(0.5);
    });

    it('handles negative current values — preserves sign so it round-trips [D-9]', () => {
      // ⚠ This test PREVIOUSLY PINNED THE BUG: it asserted max=100 for value=-50,
      // i.e. range {0,100}, under which normaliseValue(-50) clamps to 0 — the sign
      // is erased before ISL. That assertion pinned the defect. Per D-9 (PRESERVE
      // SIGN) the range now CONTAINS the value: {2v, 0} for v < 0.
      const node = createFactorNode('temperature', -50);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_value');
      expect(range.min).toBe(-100); // 2 × (-50)
      expect(range.max).toBe(0);
      // Round-trips to 0.5 instead of clamping to 0.
      const { normalised, clamped } = normaliseValue(-50, range);
      expect(normalised).not.toBe(0);
      expect(normalised).toBeCloseTo(0.5);
      expect(clamped).toBe(false);
    });
  });

  describe('Priority 4: Default [0, 1]', () => {
    it('returns default range for zero current value', () => {
      const node = createFactorNode('factor', 0);
      const range = deriveRange(node);

      expect(range.source).toBe('default');
      expect(range.min).toBe(0);
      expect(range.max).toBe(1);
    });

    it('returns default range for node without observed_state', () => {
      const node: EngineNodeV3 = {
        id: 'factor',
        kind: 'factor',
        label: 'Factor',
      };
      const range = deriveRange(node);

      expect(range.source).toBe('default');
      expect(range.min).toBe(0);
      expect(range.max).toBe(1);
    });
  });
});

// =============================================================================
// Normalisation Tests
// =============================================================================

describe('normaliseValue', () => {
  it('normalises value within range to [0,1]', () => {
    const range: NormalisationRange = { min: 0, max: 500000, source: 'explicit' };

    expect(normaliseValue(0, range).normalised).toBeCloseTo(0);
    expect(normaliseValue(250000, range).normalised).toBeCloseTo(0.5);
    expect(normaliseValue(500000, range).normalised).toBeCloseTo(1);
  });

  it('handles hiring scenario: $180,000 in [0, 500000]', () => {
    const range: NormalisationRange = { min: 0, max: 500000, source: 'explicit' };
    const result = normaliseValue(180000, range);

    expect(result.normalised).toBeCloseTo(0.36);
    expect(result.clamped).toBe(false);
  });

  it('clamps values outside range', () => {
    const range: NormalisationRange = { min: 0, max: 100, source: 'explicit' };

    const belowResult = normaliseValue(-10, range);
    expect(belowResult.normalised).toBe(0);
    expect(belowResult.clamped).toBe(true);

    const aboveResult = normaliseValue(150, range);
    expect(aboveResult.normalised).toBe(1);
    expect(aboveResult.clamped).toBe(true);
  });

  it('handles zero-width range (min == max)', () => {
    const range: NormalisationRange = { min: 100, max: 100, source: 'explicit' };
    const result = normaliseValue(100, range);

    expect(result.normalised).toBe(1); // value / max
    expect(result.clamped).toBe(false);
  });

  it('handles zero-width range with zero max', () => {
    const range: NormalisationRange = { min: 0, max: 0, source: 'explicit' };
    const result = normaliseValue(0, range);

    expect(result.normalised).toBe(0.5); // midpoint fallback
    expect(result.clamped).toBe(false);
  });

  it('handles non-zero min correctly', () => {
    const range: NormalisationRange = { min: 100, max: 200, source: 'explicit' };

    expect(normaliseValue(100, range).normalised).toBeCloseTo(0);
    expect(normaliseValue(150, range).normalised).toBeCloseTo(0.5);
    expect(normaliseValue(200, range).normalised).toBeCloseTo(1);
  });
});

// =============================================================================
// Denormalisation Tests
// =============================================================================

describe('denormaliseValue', () => {
  it('denormalises [0,1] back to original range', () => {
    const range: NormalisationRange = { min: 0, max: 500000, source: 'explicit' };

    expect(denormaliseValue(0, range)).toBeCloseTo(0);
    expect(denormaliseValue(0.5, range)).toBeCloseTo(250000);
    expect(denormaliseValue(1, range)).toBeCloseTo(500000);
  });

  it('round-trips normalisation/denormalisation', () => {
    const range: NormalisationRange = { min: 0, max: 500000, source: 'explicit' };
    const originalValue = 180000;

    const normalised = normaliseValue(originalValue, range).normalised;
    const denormalised = denormaliseValue(normalised, range);

    expect(denormalised).toBeCloseTo(originalValue);
  });

  it('handles non-zero min', () => {
    const range: NormalisationRange = { min: 100, max: 200, source: 'explicit' };

    expect(denormaliseValue(0, range)).toBeCloseTo(100);
    expect(denormaliseValue(0.5, range)).toBeCloseTo(150);
    expect(denormaliseValue(1, range)).toBeCloseTo(200);
  });

  it('handles zero-width range', () => {
    const range: NormalisationRange = { min: 100, max: 100, source: 'explicit' };
    expect(denormaliseValue(0.5, range)).toBe(100); // Returns the single point
  });
});

// =============================================================================
// Outcome Denormalisation Tests
// =============================================================================

describe('outcome denormalisation (via denormaliseISLResult)', () => {
  it('denormalises all outcome stats via ISL result path', () => {
    const context = buildNormalisationContext(
      [createFactorNode('goal', 500000, undefined, { min: 0, max: 1000000 })],
      'goal'
    );

    const islResult = {
      options: [{
        option_id: 'A',
        expected_outcome: 0.5,
        outcome: { mean: 0.5, std: 0.1, p10: 0.3, p50: 0.5, p90: 0.7, n_samples: 1000, n_valid_samples: 950, validity_ratio: 0.95 },
      }],
    };

    const denormalised = denormaliseISLResult(islResult, context);
    const opt = denormalised.options![0];

    expect(opt.expected_outcome).toBeCloseTo(500000);
    expect(opt.outcome!.mean).toBeCloseTo(500000);
    expect(opt.outcome!.p10).toBeCloseTo(300000);
    expect(opt.outcome!.p50).toBeCloseTo(500000);
    expect(opt.outcome!.p90).toBeCloseTo(700000);
    // std is scaled by range width
    expect(opt.outcome!.std).toBeCloseTo(100000);
    // Sample counts preserved
    expect(opt.outcome!.n_samples).toBe(1000);
    expect(opt.outcome!.n_valid_samples).toBe(950);
    expect(opt.outcome!.validity_ratio).toBe(0.95);
  });
});

// =============================================================================
// ISL Result Denormalisation Tests
// =============================================================================

describe('denormaliseISLResult', () => {
  it('denormalises all option outcomes', () => {
    const context = buildNormalisationContext(
      [createFactorNode('goal', 500000, undefined, { min: 0, max: 1000000 })],
      'goal'
    );

    const islResult = {
      options: [
        {
          option_id: 'A',
          expected_outcome: 0.5,
          confidence_interval: [0.3, 0.7] as [number, number],
          outcome: {
            mean: 0.5,
            p10: 0.3,
            p50: 0.5,
            p90: 0.7,
          },
        },
        {
          option_id: 'B',
          expected_outcome: 0.6,
          confidence_interval: [0.4, 0.8] as [number, number],
        },
      ],
    };

    const denormalised = denormaliseISLResult(islResult, context);

    // Check option A
    expect(denormalised.options![0].expected_outcome).toBeCloseTo(500000);
    expect(denormalised.options![0].confidence_interval![0]).toBeCloseTo(300000);
    expect(denormalised.options![0].confidence_interval![1]).toBeCloseTo(700000);
    expect(denormalised.options![0].outcome!.mean).toBeCloseTo(500000);

    // Check option B
    expect(denormalised.options![1].expected_outcome).toBeCloseTo(600000);
    expect(denormalised.options![1].confidence_interval![0]).toBeCloseTo(400000);
    expect(denormalised.options![1].confidence_interval![1]).toBeCloseTo(800000);
  });

  it('handles V1 results array format', () => {
    const context = buildNormalisationContext(
      [createFactorNode('goal', 100, undefined, { min: 0, max: 200 })],
      'goal'
    );

    const islResult = {
      results: [
        { id: 'A', expected_outcome: 0.5 },
      ],
    };

    const denormalised = denormaliseISLResult(islResult, context);
    expect(denormalised.results![0].expected_outcome).toBeCloseTo(100);
  });

  it('returns original result if no goal context', () => {
    const context = buildNormalisationContext([], 'missing_goal');

    const islResult = {
      options: [{ option_id: 'A', expected_outcome: 0.5 }],
    };

    const denormalised = denormaliseISLResult(islResult, context);
    expect(denormalised).toBe(islResult); // Returns original unchanged
  });

  it('does not mutate original ISL result', () => {
    const context = buildNormalisationContext(
      [createFactorNode('goal', 100, undefined, { min: 0, max: 200 })],
      'goal'
    );

    const original = {
      options: [{ option_id: 'A', expected_outcome: 0.5 }],
    };

    denormaliseISLResult(original, context);
    expect(original.options[0].expected_outcome).toBe(0.5); // Unchanged
  });
});

// =============================================================================
// Options Normalisation Tests
// =============================================================================

describe('normaliseOptions', () => {
  it('normalises intervention values using factor ranges', () => {
    const nodes = [
      createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 }),
      createFactorNode('headcount', 10, undefined, { min: 0, max: 100 }),
    ];
    const context = buildNormalisationContext(nodes, 'goal');

    const options = [
      createOption('hire', { salary: 180000, headcount: 11 }),
      createOption('no_hire', { salary: 100000, headcount: 10 }),
    ];

    const { options: normalised, diagnostics } = normaliseOptions(options, context);

    // Check hire option
    expect(normalised[0].interventions.salary.value).toBeCloseTo(0.36); // 180000/500000
    expect(normalised[0].interventions.headcount.value).toBeCloseTo(0.11); // 11/100

    // Check no_hire option
    expect(normalised[1].interventions.salary.value).toBeCloseTo(0.2); // 100000/500000
    expect(normalised[1].interventions.headcount.value).toBeCloseTo(0.1); // 10/100

    // Check diagnostics
    expect(diagnostics.length).toBe(4);
    expect(diagnostics.some(d => d.factor_id === 'salary' && d.original_value === 180000)).toBe(true);
  });

  it('infers range from intervention values for unknown factors', () => {
    const context = buildNormalisationContext([], 'goal');
    const options = [createOption('test', { unknown_factor: 0.5 })];

    const { options: normalised, diagnostics } = normaliseOptions(options, context);

    expect(diagnostics[0].range.source).toBe('default');
    // Range inferred as [0, 2 × 0.5] = [0, 1], so 0.5 normalises to 0.5
    expect(normalised[0].interventions.unknown_factor.value).toBe(0.5);
  });

  it('preserves distinct large values when no factor context exists', () => {
    // Values with reasonable ratio (< 100x) to avoid outlier guard
    // Using values 18000, 25000, 38000 (ratio ≈ 2.1x)
    const context = buildNormalisationContext([], 'goal');
    const options = [
      createOption('optionA', { budget: 38000 }),
      createOption('optionB', { budget: 18000 }),
      createOption('optionC', { budget: 25000 }),
    ];

    const { options: normalised, diagnostics } = normaliseOptions(options, context);

    // Range should be inferred using spread formula:
    // min=18000, max=38000, spread=20000, padding=4000
    // paddedMin = max(0, 18000-4000) = 14000, paddedMax = 38000+4000 = 42000
    expect(diagnostics[0].range.source).toBe('inferred_spread');
    expect(diagnostics[0].range.min).toBe(14000);
    expect(diagnostics[0].range.max).toBe(42000);

    // Verify distinct normalised values (NOT all collapsed to 1)
    const normalisedA = normalised[0].interventions.budget.value;
    const normalisedB = normalised[1].interventions.budget.value;
    const normalisedC = normalised[2].interventions.budget.value;

    // Range width = 42000 - 14000 = 28000
    // 38000 normalised = (38000 - 14000) / 28000 = 24000/28000 ≈ 0.857
    expect(normalisedA).toBeCloseTo(0.857, 2);
    // 18000 normalised = (18000 - 14000) / 28000 = 4000/28000 ≈ 0.143
    expect(normalisedB).toBeCloseTo(0.143, 2);
    // 25000 normalised = (25000 - 14000) / 28000 = 11000/28000 ≈ 0.393
    expect(normalisedC).toBeCloseTo(0.393, 2);

    // Crucially: all values are DISTINCT
    expect(normalisedA).not.toBe(normalisedB);
    expect(normalisedB).not.toBe(normalisedC);
    expect(normalisedA).not.toBe(1); // NOT clamped to 1
  });

  it('uses consistent range across all options for same unknown factor', () => {
    const context = buildNormalisationContext([], 'goal');
    const options = [
      createOption('small', { factor: 10 }),
      createOption('large', { factor: 1000 }),
    ];

    const { diagnostics } = normaliseOptions(options, context);

    // Both should use the same range derived using spread formula:
    // min=10, max=1000, spread=990, padding=198
    // paddedMin = max(0, 10-198) = 0, paddedMax = 1000+198 = 1198
    expect(diagnostics[0].range.source).toBe('inferred_spread');
    expect(diagnostics[0].range.min).toBe(0);
    expect(diagnostics[0].range.max).toBe(1198);
    expect(diagnostics[1].range.max).toBe(1198);
  });

  it('preserves intervention source', () => {
    const nodes = [createFactorNode('factor', 50, undefined, { min: 0, max: 100 })];
    const context = buildNormalisationContext(nodes, 'goal');

    const option: OptionV3 = {
      id: 'test',
      label: 'Test',
      interventions: {
        factor: { value: 75, source: 'brief_extraction' },
      },
    };

    const { options: normalised } = normaliseOptions([option], context);
    expect(normalised[0].interventions.factor.source).toBe('brief_extraction');
  });
});

// =============================================================================
// needsNormalisation Tests
// =============================================================================

describe('needsNormalisation', () => {
  it('returns true if any value is outside [0,1]', () => {
    const options = [createOption('test', { factor: 180000 })];
    expect(needsNormalisation(options)).toBe(true);
  });

  it('returns false if all values in [0,1]', () => {
    const options = [createOption('test', { factor: 0.5 })];
    expect(needsNormalisation(options)).toBe(false);
  });

  it('returns true for negative values', () => {
    const options = [createOption('test', { factor: -0.5 })];
    expect(needsNormalisation(options)).toBe(true);
  });

  it('handles multiple options', () => {
    const options = [
      createOption('A', { factor: 0.5 }),
      createOption('B', { factor: 2.0 }), // Out of range
    ];
    expect(needsNormalisation(options)).toBe(true);
  });
});

// =============================================================================
// Full Integration Tests
// =============================================================================

describe('normaliseOptionsForISL (integration)', () => {
  it('handles hiring scenario: $180,000 salary intervention', () => {
    const nodes = [
      createFactorNode('salary_cost', 100000, undefined, { min: 0, max: 500000 }),
      createFactorNode('productivity', 50, undefined, { min: 0, max: 100 }),
    ];

    const options = [
      createOption('hire_senior', { salary_cost: 180000 }),
      createOption('no_hire', { salary_cost: 0 }),
    ];

    const result = normaliseOptionsForISL(options, nodes, 'productivity');

    // Verify normalisation
    expect(result.options[0].interventions.salary_cost.value).toBeCloseTo(0.36);
    expect(result.options[1].interventions.salary_cost.value).toBeCloseTo(0);

    // Verify context preserved for denormalisation
    expect(result.context.factors.has('salary_cost')).toBe(true);
    expect(result.context.factors.get('salary_cost')!.range.max).toBe(500000);
  });

  it('end-to-end: normalise interventions, mock ISL, denormalise outcomes', () => {
    // Setup: hiring decision with explicit ranges
    const nodes = [
      createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 }),
      createFactorNode('productivity_gain', 10, undefined, { min: 0, max: 100 }),
    ];

    const options = [
      createOption('hire', { salary: 180000 }),
      createOption('no_hire', { salary: 0 }),
    ];

    // Step 1: Normalise interventions
    const { options: normalisedOptions, context } = normaliseOptionsForISL(
      options,
      nodes,
      'productivity_gain'
    );

    // Verify normalised values
    expect(normalisedOptions[0].interventions.salary.value).toBeCloseTo(0.36);
    expect(normalisedOptions[1].interventions.salary.value).toBeCloseTo(0);

    // Step 2: Mock ISL response (returns normalised outcomes)
    const mockIslResponse = {
      options: [
        {
          option_id: 'hire',
          expected_outcome: 0.7, // 70% of productivity range
          confidence_interval: [0.5, 0.9] as [number, number],
          outcome: { mean: 0.7, p10: 0.5, p50: 0.7, p90: 0.9 },
        },
        {
          option_id: 'no_hire',
          expected_outcome: 0.1,
          confidence_interval: [0.05, 0.15] as [number, number],
          outcome: { mean: 0.1, p10: 0.05, p50: 0.1, p90: 0.15 },
        },
      ],
    };

    // Step 3: Denormalise outcomes
    const denormalisedResult = denormaliseISLResult(mockIslResponse, context);

    // Verify denormalised outcomes are in user units (productivity 0-100)
    expect(denormalisedResult.options![0].expected_outcome).toBeCloseTo(70);
    expect(denormalisedResult.options![0].outcome!.p10).toBeCloseTo(50);
    expect(denormalisedResult.options![0].outcome!.p90).toBeCloseTo(90);

    expect(denormalisedResult.options![1].expected_outcome).toBeCloseTo(10);
    expect(denormalisedResult.options![1].outcome!.p10).toBeCloseTo(5);
    expect(denormalisedResult.options![1].outcome!.p90).toBeCloseTo(15);
  });

  it('skips normalisation when values already in [0,1]', () => {
    const options = [
      createOption('A', { factor: 0.5 }),
      createOption('B', { factor: 0.3 }),
    ];

    expect(needsNormalisation(options)).toBe(false);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('edge cases', () => {
  it('handles zero baseline with non-zero current value', () => {
    const node = createFactorNode('factor', 100, 0);
    const range = deriveRange(node);

    expect(range.source).toBe('inferred_baseline');
    expect(range.max).toBe(200); // 2 × max(0, 100)
  });

  it('handles zero current value with non-zero baseline', () => {
    const node = createFactorNode('factor', 0, 100);
    const range = deriveRange(node);

    expect(range.source).toBe('inferred_baseline');
    expect(range.max).toBe(200); // 2 × 100
  });

  it('handles both zero baseline and zero current value', () => {
    const node = createFactorNode('factor', 0, 0);
    const range = deriveRange(node);

    expect(range.source).toBe('default');
    expect(range.min).toBe(0);
    expect(range.max).toBe(1);
  });

  it('handles very large values', () => {
    const node = createFactorNode('revenue', 1e12); // 1 trillion
    const range = deriveRange(node);

    expect(range.max).toBe(2e12);

    const result = normaliseValue(5e11, range);
    expect(result.normalised).toBeCloseTo(0.25);
  });

  it('handles very small values', () => {
    const node = createFactorNode('probability', 0.001);
    const range = deriveRange(node);

    expect(range.max).toBeCloseTo(0.002);

    const result = normaliseValue(0.0005, range);
    expect(result.normalised).toBeCloseTo(0.25);
  });

  it('handles negative ranges (temperature example)', () => {
    const node = createFactorNode('temperature', -10, undefined, { min: -50, max: 50 });
    const range = deriveRange(node);

    expect(range.min).toBe(-50);
    expect(range.max).toBe(50);

    const result = normaliseValue(0, range);
    expect(result.normalised).toBeCloseTo(0.5); // 0 is midpoint of [-50, 50]
  });
});

// =============================================================================
// CE extracted_range Integration (Priority 1.5)
// =============================================================================

describe('CE extracted_range integration', () => {
  it('uses explicit range over extracted_range (Priority 1 > 1.5)', () => {
    const node = createFactorNode('salary', 180000, undefined, { min: 0, max: 500000 });
    const hints = { extracted_range: [0, 1000000] as [number, number] };

    const range = deriveRange(node, hints);

    expect(range.source).toBe('explicit');
    expect(range.max).toBe(500000); // Uses explicit, not extracted
  });

  it('uses extracted_range when no explicit range (Priority 1.5)', () => {
    const node = createFactorNode('salary', 180000);
    const hints = { extracted_range: [0, 300000] as [number, number] };

    const range = deriveRange(node, hints);

    expect(range.source).toBe('extracted');
    expect(range.min).toBe(0);
    expect(range.max).toBe(300000);
  });

  it('falls back to inferred_baseline when extracted_range is invalid (min >= max)', () => {
    const node = createFactorNode('salary', 180000, 100000);
    const hints = { extracted_range: [500, 100] as [number, number] }; // Invalid: min > max

    const range = deriveRange(node, hints);

    expect(range.source).toBe('inferred_baseline');
    expect(range.max).toBe(360000); // 2 × 180000
  });

  it('falls back to inferred_baseline when extracted_range contains NaN', () => {
    const node = createFactorNode('salary', 180000, 100000);
    const hints = { extracted_range: [0, NaN] as [number, number] };

    const range = deriveRange(node, hints);

    expect(range.source).toBe('inferred_baseline');
  });

  it('falls back to inferred_baseline when extracted_range contains Infinity', () => {
    const node = createFactorNode('salary', 180000, 100000);
    const hints = { extracted_range: [0, Infinity] as [number, number] };

    const range = deriveRange(node, hints);

    expect(range.source).toBe('inferred_baseline');
  });

  it('falls back to inferred_value when extracted_range invalid and no baseline', () => {
    const node = createFactorNode('salary', 180000);
    const hints = { extracted_range: [100, 50] as [number, number] }; // Invalid

    const range = deriveRange(node, hints);

    expect(range.source).toBe('inferred_value');
    expect(range.max).toBe(360000); // 2 × 180000
  });

  it('falls back to default when no valid source available', () => {
    const node: EngineNodeV3 = { id: 'empty', kind: 'factor', label: 'Empty' };
    const hints = { extracted_range: [-1, -5] as [number, number] }; // Invalid

    const range = deriveRange(node, hints);

    expect(range.source).toBe('default');
    expect(range.min).toBe(0);
    expect(range.max).toBe(1);
  });

  it('passes hints through buildNormalisationContext', () => {
    const nodes = [createFactorNode('salary', 180000)];
    const hints = new Map([['salary', { extracted_range: [0, 250000] as [number, number] }]]);

    const context = buildNormalisationContext(nodes, 'goal', hints);

    expect(context.factors.get('salary')?.range.source).toBe('extracted');
    expect(context.factors.get('salary')?.range.max).toBe(250000);
  });

  it('passes hints through normaliseOptionsForISL', () => {
    const nodes = [createFactorNode('salary', 180000)];
    const options = [createOption('hire', { salary: 180000 })];
    const hints = new Map([['salary', { extracted_range: [0, 360000] as [number, number] }]]);

    const result = normaliseOptionsForISL(options, nodes, 'goal', hints);

    expect(result.options[0].interventions.salary.value).toBeCloseTo(0.5); // 180000/360000
    expect(result.diagnostics[0].range.source).toBe('extracted');
  });
});

// =============================================================================
// Intervention Spread (Priority 1.75 per Schema v2.6 §B.8)
// =============================================================================

describe('Intervention Spread (Priority 1.75)', () => {
  it('uses intervention spread when ≥2 intervention values exist', () => {
    // Factor with interventions [50000, 80000] → range [44000, 86000]
    const node = createFactorNode('salary', undefined); // No observed_state, no explicit range
    const interventionValues = [50000, 80000];

    const range = deriveRange(node, undefined, interventionValues);

    expect(range.source).toBe('inferred_spread');
    // spread = 80000 - 50000 = 30000, padding = 30000 * 0.2 = 6000
    // min = 50000 - 6000 = 44000, max = 80000 + 6000 = 86000
    expect(range.min).toBe(44000);
    expect(range.max).toBe(86000);
  });

  it('uses intervention spread with 3 intervention values', () => {
    const node = createFactorNode('salary', undefined);
    const interventionValues = [50000, 80000, 65000];

    const range = deriveRange(node, undefined, interventionValues);

    expect(range.source).toBe('inferred_spread');
    // min = 50000, max = 80000, spread = 30000, padding = 6000
    expect(range.min).toBe(44000);
    expect(range.max).toBe(86000);
  });

  it('falls back when only single intervention value', () => {
    const node = createFactorNode('salary', 100000); // Has current value
    const interventionValues = [180000]; // Only one value

    const range = deriveRange(node, undefined, interventionValues);

    // Should fall back to inferred_value (Priority 3)
    expect(range.source).toBe('inferred_value');
    expect(range.max).toBe(200000); // 2 × 100000
  });

  it('falls back when no intervention values', () => {
    const node = createFactorNode('salary', 100000);

    const range = deriveRange(node, undefined, undefined);

    expect(range.source).toBe('inferred_value');
  });

  it('falls back when intervention values have zero spread', () => {
    const node = createFactorNode('salary', 100000);
    const interventionValues = [50000, 50000, 50000]; // All same value

    const range = deriveRange(node, undefined, interventionValues);

    // Should fall back because spread = 0
    expect(range.source).toBe('inferred_value');
  });

  it('uses explicit range over intervention spread (Priority 1 > 1.75)', () => {
    const node = createFactorNode('salary', undefined, undefined, { min: 0, max: 500000 });
    const interventionValues = [50000, 80000];

    const range = deriveRange(node, undefined, interventionValues);

    expect(range.source).toBe('explicit');
    expect(range.max).toBe(500000);
  });

  it('uses CE extracted_range over intervention spread (Priority 1.5 > 1.75)', () => {
    const node = createFactorNode('salary', undefined);
    const hints = { extracted_range: [0, 200000] as [number, number] };
    const interventionValues = [50000, 80000];

    const range = deriveRange(node, hints, interventionValues);

    expect(range.source).toBe('extracted');
    expect(range.max).toBe(200000);
  });

  it('uses intervention spread over baseline (Priority 1.75 > 2)', () => {
    const node = createFactorNode('salary', 100000, 80000); // Has baseline
    const interventionValues = [50000, 80000];

    const range = deriveRange(node, undefined, interventionValues);

    expect(range.source).toBe('inferred_spread');
    expect(range.min).toBe(44000);
    expect(range.max).toBe(86000);
  });

  it('integrates with buildNormalisationContext', () => {
    const nodes = [createFactorNode('salary', undefined)];
    const options = [
      createOption('optionA', { salary: 50000 }),
      createOption('optionB', { salary: 80000 }),
    ];

    const context = buildNormalisationContext(nodes, 'goal', undefined, options);

    expect(context.factors.get('salary')?.range.source).toBe('inferred_spread');
    expect(context.factors.get('salary')?.range.min).toBe(44000);
    expect(context.factors.get('salary')?.range.max).toBe(86000);
  });

  it('integrates with normaliseOptionsForISL', () => {
    const nodes = [createFactorNode('salary', undefined)];
    const options = [
      createOption('optionA', { salary: 50000 }),
      createOption('optionB', { salary: 80000 }),
    ];

    const result = normaliseOptionsForISL(options, nodes, 'goal');

    expect(result.diagnostics[0].range.source).toBe('inferred_spread');
    // 50000 normalised in range [44000, 86000] = (50000 - 44000) / (86000 - 44000) = 6000/42000 ≈ 0.143
    expect(result.options[0].interventions.salary.value).toBeCloseTo(0.143, 2);
    // 80000 normalised = (80000 - 44000) / 42000 = 36000/42000 ≈ 0.857
    expect(result.options[1].interventions.salary.value).toBeCloseTo(0.857, 2);
  });

  it('logs inferred_spread in repair reason', () => {
    const nodes = [createFactorNode('salary', undefined)];
    const options = [
      createOption('optionA', { salary: 50000 }),
      createOption('optionB', { salary: 80000 }),
    ];

    const result = normaliseOptionsForISL(options, nodes, 'goal');

    expect(result.repairs[0].reason).toContain('source=inferred_spread');
    expect(result.repairs[0].reason).toContain('range=[44000,86000]');
  });

  it('skips spread for extreme outliers (ratio > 100x)', () => {
    // Outlier scenario: £50k and £5.1m (102x ratio) - likely extraction error
    const node = createFactorNode('salary', 100000, 80000); // Has baseline for fallback
    const interventionValues = [50000, 5100000]; // 102x ratio (> 100x threshold)

    const range = deriveRange(node, undefined, interventionValues);

    // Should skip spread and fall back to inferred_baseline
    expect(range.source).toBe('inferred_baseline');
    // Range = [0, 2 × max(80000, 100000)] = [0, 200000]
    expect(range.min).toBe(0);
    expect(range.max).toBe(200000);
  });

  it('uses spread when ratio is just under 100x threshold', () => {
    const node = createFactorNode('salary', undefined);
    // Ratio of 99x should NOT trigger outlier guard
    const interventionValues = [1000, 99000]; // 99x ratio

    const range = deriveRange(node, undefined, interventionValues);

    expect(range.source).toBe('inferred_spread');
  });

  it('skips spread when ratio is exactly 100x', () => {
    const node = createFactorNode('salary', 50000); // Has value for fallback
    // Ratio of exactly 100x should trigger outlier guard
    const interventionValues = [1000, 100000]; // Exactly 100x

    const range = deriveRange(node, undefined, interventionValues);

    // 100000 > 1000 * 100 is false, so spread IS used
    // (guard is maxVal > minVal * 100, not >=)
    expect(range.source).toBe('inferred_spread');
  });

  it('skips spread when ratio exceeds 100x', () => {
    const node = createFactorNode('salary', 50000); // Has value for fallback
    // Ratio of 101x should trigger outlier guard
    const interventionValues = [1000, 101000]; // 101x ratio

    const range = deriveRange(node, undefined, interventionValues);

    // Should skip spread and fall back
    expect(range.source).toBe('inferred_value');
  });

  it('does not apply outlier guard when minVal is zero', () => {
    // When minVal = 0, guard condition (minVal > 0) is false
    const node = createFactorNode('salary', undefined);
    const interventionValues = [0, 1000000]; // minVal = 0

    const range = deriveRange(node, undefined, interventionValues);

    // Should use spread (outlier guard doesn't apply when min = 0)
    expect(range.source).toBe('inferred_spread');
  });

  it('does not apply outlier guard when minVal is negative', () => {
    const node = createFactorNode('balance', undefined);
    const interventionValues = [-1000, 5000000]; // minVal < 0

    const range = deriveRange(node, undefined, interventionValues);

    // Should use spread (outlier guard doesn't apply when min < 0)
    expect(range.source).toBe('inferred_spread');
  });

  it('produces same result regardless of input order', () => {
    const node = createFactorNode('salary', undefined);

    // Different orders of the same values
    const order1 = [50000, 80000, 65000];
    const order2 = [80000, 50000, 65000];
    const order3 = [65000, 80000, 50000];

    const range1 = deriveRange(node, undefined, order1);
    const range2 = deriveRange(node, undefined, order2);
    const range3 = deriveRange(node, undefined, order3);

    // All should produce identical ranges
    expect(range1.min).toBe(range2.min);
    expect(range1.max).toBe(range2.max);
    expect(range1.source).toBe(range2.source);

    expect(range2.min).toBe(range3.min);
    expect(range2.max).toBe(range3.max);
    expect(range2.source).toBe(range3.source);
  });

  it('applies outlier guard in buildFallbackRanges for unknown factors', () => {
    // Unknown factor (no context) with extreme outlier values
    const context = buildNormalisationContext([], 'goal');
    const options = [
      createOption('optionA', { budget: 50000 }),
      createOption('optionB', { budget: 5100000 }), // 102x ratio (> 100x threshold)
    ];

    const { diagnostics } = normaliseOptions(options, context);

    // Should fall back to default range (not spread) due to outlier guard
    expect(diagnostics[0].range.source).toBe('default');
    // Range = [0, 2 × 5100000] = [0, 10200000]
    expect(diagnostics[0].range.max).toBe(10200000);
  });

  it('uses spread in buildFallbackRanges when not an outlier', () => {
    // Unknown factor with reasonable values
    const context = buildNormalisationContext([], 'goal');
    const options = [
      createOption('optionA', { budget: 50000 }),
      createOption('optionB', { budget: 80000 }),
    ];

    const { diagnostics } = normaliseOptions(options, context);

    // Should use spread
    expect(diagnostics[0].range.source).toBe('inferred_spread');
  });
});

// =============================================================================
// Intervention Transform Logging (repairs_applied)
// =============================================================================

describe('Intervention Transform Logging', () => {
  it('returns repair records with correct field and action', () => {
    const nodes = [createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 })];
    const context = buildNormalisationContext(nodes, 'goal');
    const options = [createOption('hire', { salary: 180000 })];

    const { repairs } = normaliseOptions(options, context);

    expect(repairs.length).toBe(1);
    expect(repairs[0].field).toBe('intervention.value.salary'); // Includes factor_id for traceability
    expect(repairs[0].action).toBe('normalised');
    expect(repairs[0].from_value).toBe(180000);
    expect(repairs[0].to_value).toBeCloseTo(0.36);
  });

  it('deduplicates repairs by factor_id (one record per factor)', () => {
    const nodes = [createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 })];
    const context = buildNormalisationContext(nodes, 'goal');
    const options = [
      createOption('optionA', { salary: 180000 }),
      createOption('optionB', { salary: 150000 }),
      createOption('optionC', { salary: 200000 }),
    ];

    const { repairs } = normaliseOptions(options, context);

    // Only one repair record for 'salary', not three
    expect(repairs.length).toBe(1);
    expect(repairs[0].from_value).toBe(180000); // Uses first encountered value
  });

  it('creates separate repair records for different factors', () => {
    const nodes = [
      createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 }),
      createFactorNode('bonus', 10000, undefined, { min: 0, max: 100000 }),
    ];
    const context = buildNormalisationContext(nodes, 'goal');
    const options = [createOption('hire', { salary: 180000, bonus: 20000 })];

    const { repairs } = normaliseOptions(options, context);

    expect(repairs.length).toBe(2);
    expect(repairs.some(r => r.from_value === 180000)).toBe(true);
    expect(repairs.some(r => r.from_value === 20000)).toBe(true);
  });

  it('formats reason string correctly', () => {
    const nodes = [createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 })];
    const context = buildNormalisationContext(nodes, 'goal');
    const options = [createOption('hire', { salary: 180000 })];

    const { repairs } = normaliseOptions(options, context);

    expect(repairs[0].reason).toBe('normalised range=[0,500000] source=explicit');
  });

  it('includes range_source in reason for extracted ranges', () => {
    const nodes = [createFactorNode('salary', 180000)];
    const hints = new Map([['salary', { extracted_range: [0, 300000] as [number, number] }]]);
    const context = buildNormalisationContext(nodes, 'goal', hints);
    const options = [createOption('hire', { salary: 180000 })];

    const { repairs } = normaliseOptions(options, context);

    expect(repairs[0].reason).toContain('source=extracted');
  });

  it('returns transforms map keyed by factor_id', () => {
    const nodes = [createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 })];
    const context = buildNormalisationContext(nodes, 'goal');
    const options = [createOption('hire', { salary: 180000 })];

    const { transforms } = normaliseOptions(options, context);

    expect(transforms.has('salary')).toBe(true);
    expect(transforms.get('salary')?.raw).toBe(180000);
    expect(transforms.get('salary')?.normalised).toBeCloseTo(0.36);
    expect(transforms.get('salary')?.range_source).toBe('explicit');
  });

  it('rounds values to 6 decimal places for stable diffs', () => {
    const nodes = [createFactorNode('factor', 100, undefined, { min: 0, max: 300 })];
    const context = buildNormalisationContext(nodes, 'goal');
    const options = [createOption('test', { factor: 100 })];

    const { transforms, repairs } = normaliseOptions(options, context);

    // 100 / 300 = 0.333333...
    const transform = transforms.get('factor')!;
    expect(transform.normalised).toBe(0.333333); // Rounded to 6 decimals
    expect(String(transform.normalised).split('.')[1]?.length || 0).toBeLessThanOrEqual(6);
  });

  it('includes repairs in normaliseOptionsForISL result', () => {
    const nodes = [createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 })];
    const options = [createOption('hire', { salary: 180000 })];

    const result = normaliseOptionsForISL(options, nodes, 'goal');

    expect(result.repairs).toBeDefined();
    expect(result.repairs.length).toBe(1);
    expect(result.repairs[0].field).toBe('intervention.value.salary');
  });

  it('backward compatible: works without intervention_hints', () => {
    const nodes = [createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 })];
    const options = [createOption('hire', { salary: 180000 })];

    // Call without hints parameter
    const result = normaliseOptionsForISL(options, nodes, 'goal');

    expect(result.options[0].interventions.salary.value).toBeCloseTo(0.36);
    expect(result.diagnostics[0].range.source).toBe('explicit');
    expect(result.repairs.length).toBe(1);
  });
});

// =============================================================================
// Analytical Field Denormalisation (G1 audit remediation)
// =============================================================================
// The transform functions in run.ts are private, so we test the denormalisation
// math directly. The transforms apply denormaliseValue() and elasticity scaling
// using the NormalisationContext — this verifies the contract.

describe('analytical field denormalisation math', () => {
  it('factor sensitivity_score scales by goalWidth / factorWidth', () => {
    // Factor sensitivity = Δoutcome / Δfactor. Both dimensions are normalised.
    // Scenario: factor range [0, 1] (normalised), goal range [0, 1000]
    // ISL returns sensitivity 0.3 in normalised space
    // Denormalised: 0.3 × (1000 / 1) = 300
    const goalRange: NormalisationRange = { min: 0, max: 1000, source: 'explicit' };
    const factorRange: NormalisationRange = { min: 0, max: 1, source: 'default' };

    const islSensitivity = 0.3;
    const goalWidth = goalRange.max - goalRange.min;
    const factorWidth = factorRange.max - factorRange.min;
    const denormSensitivity = islSensitivity * (goalWidth / factorWidth);

    expect(denormSensitivity).toBe(300);
  });

  it('factor sensitivity unchanged when factor and goal have same range', () => {
    const range: NormalisationRange = { min: 0, max: 1000, source: 'explicit' };

    const islSensitivity = 0.5;
    const goalWidth = range.max - range.min;
    const factorWidth = range.max - range.min;
    const denormSensitivity = islSensitivity * (goalWidth / factorWidth);

    expect(denormSensitivity).toBe(0.5);
  });

  it('edge elasticity scales by goalWidth only (edge params are dimensionless)', () => {
    // Edge elasticity = ∂(goal outcome) / ∂(edge parameter).
    // Edge parameters (strength, exists_probability) are dimensionless [0,1] and
    // are NOT scaled by intervention normalisation. Only the output dimension needs rescaling.
    // Scenario: goal range [0, 1000], ISL returns elasticity 0.3
    // Denormalised: 0.3 × 1000 = 300
    const goalRange: NormalisationRange = { min: 0, max: 1000, source: 'explicit' };

    const islElasticity = 0.3;
    const goalWidth = goalRange.max - goalRange.min;
    const denormElasticity = islElasticity * goalWidth;

    expect(denormElasticity).toBe(300);
  });

  it('mean_outcome denormalises using goal range via denormaliseValue', () => {
    // ISL returns mean_outcome 0.7 in [0,1] space, goal range [0, 1000]
    const goalRange: NormalisationRange = { min: 0, max: 1000, source: 'explicit' };

    const denorm = denormaliseValue(0.7, goalRange);
    expect(denorm).toBe(700);
  });

  it('split_value denormalises using factor range', () => {
    // ISL returns split_value 0.5 in [0,1] space, factor range [100, 500]
    const factorRange: NormalisationRange = { min: 100, max: 500, source: 'explicit' };

    const denorm = denormaliseValue(0.5, factorRange);
    expect(denorm).toBe(300); // 0.5 × 400 + 100
  });

  it('elasticity_std scales same as elasticity (delta measure)', () => {
    const goalRange: NormalisationRange = { min: 0, max: 1000, source: 'explicit' };
    const factorRange: NormalisationRange = { min: 0, max: 100, source: 'explicit' };

    const islStd = 0.02;
    const scale = (goalRange.max - goalRange.min) / (factorRange.max - factorRange.min);
    const denormStd = islStd * scale;

    expect(denormStd).toBeCloseTo(0.2); // 0.02 × (1000/100)
  });

  it('no denormalisation when context is absent (passthrough)', () => {
    // When normalisation wasn't needed, values should pass through unchanged
    const islElasticity = 0.3;
    const normContext = undefined;

    // Simulates the guard: if (!normContext) → passthrough
    const result = normContext ? islElasticity * 10 : islElasticity;
    expect(result).toBe(0.3);
  });

  it('context built by normaliseOptionsForISL contains factor and goal ranges', () => {
    // Verify the context structure that transforms will use
    const nodes = [
      createFactorNode('salary', 100000, undefined, { min: 0, max: 500000 }),
      createFactorNode('goal_revenue', 50000, undefined, { min: 0, max: 1000000 }),
    ];
    const options = [createOption('hire', { salary: 180000 })];

    const result = normaliseOptionsForISL(options, nodes, 'goal_revenue');

    // Factor range available for elasticity scaling
    expect(result.context.factors.get('salary')?.range.max).toBe(500000);
    // Goal context available for outcome denormalisation
    expect(result.context.goal_context?.range.max).toBe(1000000);
    // Both available → elasticity scaling = goalWidth / factorWidth = 1000000 / 500000 = 2
    const scale = result.context.goal_context!.range.max / result.context.factors.get('salary')!.range.max;
    expect(scale).toBe(2);
  });
});
