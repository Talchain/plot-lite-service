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
  denormaliseOutcome,
  denormaliseISLResult,
  normaliseOptionsForISL,
  needsNormalisation,
  type NormalisationRange,
  type FactorNormalisationContext,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, OptionV3, OutcomeStatsV3 } from '../src/types/engine-v3.js';

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
  });

  describe('Priority 3: Inferred from current value only', () => {
    it('derives range from current value when no baseline', () => {
      const node = createFactorNode('salary', 180000);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_value');
      expect(range.min).toBe(0);
      expect(range.max).toBe(360000); // 2 × 180000
    });

    it('handles negative current values', () => {
      const node = createFactorNode('temperature', -50);
      const range = deriveRange(node);

      expect(range.source).toBe('inferred_value');
      expect(range.max).toBe(100); // 2 × |-50|
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

describe('denormaliseOutcome', () => {
  const goalContext: FactorNormalisationContext = {
    factor_id: 'goal',
    range: { min: 0, max: 1000000, source: 'explicit' },
    baseline: 500000,
  };

  it('denormalises all outcome stats', () => {
    const outcome: OutcomeStatsV3 = {
      mean: 0.5,
      std: 0.1,
      p10: 0.3,
      p50: 0.5,
      p90: 0.7,
    };

    const denormalised = denormaliseOutcome(outcome, goalContext);

    expect(denormalised.mean).toBeCloseTo(500000);
    expect(denormalised.p10).toBeCloseTo(300000);
    expect(denormalised.p50).toBeCloseTo(500000);
    expect(denormalised.p90).toBeCloseTo(700000);
    // std is scaled by range width
    expect(denormalised.std).toBeCloseTo(100000);
  });

  it('preserves sample counts', () => {
    const outcome: OutcomeStatsV3 = {
      mean: 0.5,
      p10: 0.3,
      p50: 0.5,
      p90: 0.7,
      n_samples: 1000,
      n_valid_samples: 950,
      validity_ratio: 0.95,
    };

    const denormalised = denormaliseOutcome(outcome, goalContext);

    expect(denormalised.n_samples).toBe(1000);
    expect(denormalised.n_valid_samples).toBe(950);
    expect(denormalised.validity_ratio).toBe(0.95);
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
    // Reproduces the bug: values like 38000, 18000, 15 were being collapsed to 1
    const context = buildNormalisationContext([], 'goal');
    const options = [
      createOption('optionA', { budget: 38000 }),
      createOption('optionB', { budget: 18000 }),
      createOption('optionC', { budget: 15 }),
    ];

    const { options: normalised, diagnostics } = normaliseOptions(options, context);

    // Range should be inferred as [0, 2 × 38000] = [0, 76000]
    expect(diagnostics[0].range.max).toBe(76000);

    // Verify distinct normalised values (NOT all collapsed to 1)
    const normalisedA = normalised[0].interventions.budget.value;
    const normalisedB = normalised[1].interventions.budget.value;
    const normalisedC = normalised[2].interventions.budget.value;

    // 38000 / 76000 = 0.5
    expect(normalisedA).toBeCloseTo(0.5);
    // 18000 / 76000 ≈ 0.237
    expect(normalisedB).toBeCloseTo(0.237, 2);
    // 15 / 76000 ≈ 0.0002
    expect(normalisedC).toBeCloseTo(0.000197, 4);

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

    // Both should use the same range derived from max value
    expect(diagnostics[0].range.max).toBe(2000); // 2 × 1000
    expect(diagnostics[1].range.max).toBe(2000);
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
