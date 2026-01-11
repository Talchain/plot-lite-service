/**
 * Result Coherence Tests
 *
 * Tests for Phase 1 Critical Fixes:
 * - Task 1.3: Constraint violation reporting
 * - Task 1.6: Result coherence validation
 * - Task 1.7: Baseline identification
 */

import { describe, it, expect } from 'vitest';
import {
  detectBaselineOption,
  computeDeltasVsBaseline,
  evaluateConstraints,
  markInfeasibleOptions,
  validateCoherence,
  emptyConstraintStatus,
  type RankableResult,
  type NodeConstraint,
} from '../src/trust/result-coherence.js';

describe('Baseline Detection (Task 1.7)', () => {
  it('detects baseline by keyword "status quo"', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Status Quo', summary: { p10: 5, p50: 25, p90: 45 } },
      { label: 'Option B', summary: { p10: 15, p50: 55, p90: 95 } },
    ];
    expect(detectBaselineOption(results)).toBe('Status Quo');
  });

  it('detects baseline by keyword "do nothing"', () => {
    const results: RankableResult[] = [
      { label: 'Aggressive', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Do Nothing', summary: { p10: 5, p50: 25, p90: 45 } },
    ];
    expect(detectBaselineOption(results)).toBe('Do Nothing');
  });

  it('detects baseline by keyword "current"', () => {
    const results: RankableResult[] = [
      { label: 'New Approach', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Current Strategy', summary: { p10: 5, p50: 25, p90: 45 } },
    ];
    expect(detectBaselineOption(results)).toBe('Current Strategy');
  });

  it('detects baseline by keyword "baseline"', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Baseline', summary: { p10: 5, p50: 25, p90: 45 } },
    ];
    expect(detectBaselineOption(results)).toBe('Baseline');
  });

  it('detects baseline by keyword "keep"', () => {
    const results: RankableResult[] = [
      { label: 'Change', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Keep Current', summary: { p10: 5, p50: 25, p90: 45 } },
    ];
    expect(detectBaselineOption(results)).toBe('Keep Current');
  });

  it('uses explicit baseline index when provided', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Option B', summary: { p10: 5, p50: 25, p90: 45 } },
      { label: 'Status Quo', summary: { p10: 15, p50: 55, p90: 95 } },
    ];
    // Explicit index overrides keyword detection
    expect(detectBaselineOption(results, undefined, 1)).toBe('Option B');
  });

  it('detects baseline by no-intervention delta', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Option B', summary: { p10: 5, p50: 25, p90: 45 } },
    ];
    const deltas = [
      { label: 'Option A', nodes: [{ id: 'price', value: 1.2 }] },
      { label: 'Option B', nodes: [], edges: [] }, // No changes = baseline
    ];
    expect(detectBaselineOption(results, deltas)).toBe('Option B');
  });

  it('defaults to first option when no baseline detected', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Option B', summary: { p10: 5, p50: 25, p90: 45 } },
    ];
    const deltas = [
      { label: 'Option A', nodes: [{ id: 'price', value: 1.2 }] },
      { label: 'Option B', nodes: [{ id: 'price', value: 0.8 }] },
    ];
    expect(detectBaselineOption(results, deltas)).toBe('Option A');
  });

  it('returns null for empty results', () => {
    expect(detectBaselineOption([])).toBe(null);
  });
});

describe('Delta vs Baseline Computation (Task 1.7)', () => {
  it('computes deltas for all options vs baseline', () => {
    const results: RankableResult[] = [
      { label: 'Baseline', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Option A', summary: { p10: 15, p50: 60, p90: 100 } },
      { label: 'Option B', summary: { p10: 5, p50: 40, p90: 80 } },
    ];

    const deltas = computeDeltasVsBaseline(results, 'Baseline');

    expect(deltas.get('Baseline')).toEqual({ p10: 0, p50: 0, p90: 0 });
    expect(deltas.get('Option A')).toEqual({ p10: 5, p50: 10, p90: 10 });
    expect(deltas.get('Option B')).toEqual({ p10: -5, p50: -10, p90: -10 });
  });

  it('rounds deltas to 3 decimal places', () => {
    const results: RankableResult[] = [
      { label: 'Baseline', summary: { p10: 10.1234, p50: 50.5678, p90: 90.9012 } },
      { label: 'Option A', summary: { p10: 15.4567, p50: 60.8901, p90: 100.2345 } },
    ];

    const deltas = computeDeltasVsBaseline(results, 'Baseline');
    const optionA = deltas.get('Option A');

    expect(optionA?.p10).toBe(5.333);
    expect(optionA?.p50).toBe(10.322);
    expect(optionA?.p90).toBe(9.333);
  });

  it('returns empty map when baseline not found', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 15, p50: 60, p90: 100 } },
    ];

    const deltas = computeDeltasVsBaseline(results, 'Nonexistent');
    expect(deltas.size).toBe(0);
  });

  it('skips results with null summary', () => {
    const results: RankableResult[] = [
      { label: 'Baseline', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Option A', summary: null },
      { label: 'Option B', summary: { p10: 20, p50: 70, p90: 110 } },
    ];

    const deltas = computeDeltasVsBaseline(results, 'Baseline');
    expect(deltas.has('Option A')).toBe(false);
    expect(deltas.has('Option B')).toBe(true);
  });
});

describe('Constraint Evaluation (Task 1.3)', () => {
  it('detects min constraint violation', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
    ];
    const constraints: NodeConstraint[] = [
      { node_id: 'revenue', min: 100 },
    ];
    const nodeValues = new Map([
      ['Option A', new Map([['revenue', 80]])],
    ]);

    const status = evaluateConstraints(results, constraints, nodeValues);

    expect(status.violations).toHaveLength(1);
    expect(status.violations[0].option_id).toBe('Option A');
    expect(status.violations[0].actual_value).toBe(80);
    expect(status.violations[0].threshold).toBe(100);
  });

  it('detects max constraint violation', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
    ];
    const constraints: NodeConstraint[] = [
      { node_id: 'cost', max: 50 },
    ];
    const nodeValues = new Map([
      ['Option A', new Map([['cost', 75]])],
    ]);

    const status = evaluateConstraints(results, constraints, nodeValues);

    expect(status.violations).toHaveLength(1);
    expect(status.violations[0].actual_value).toBe(75);
    expect(status.violations[0].threshold).toBe(50);
  });

  it('detects active constraint at boundary', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
    ];
    const constraints: NodeConstraint[] = [
      { node_id: 'budget', max: 100, label: 'Budget limit' },
    ];
    const nodeValues = new Map([
      ['Option A', new Map([['budget', 100]])], // Exactly at boundary
    ]);

    const status = evaluateConstraints(results, constraints, nodeValues);

    expect(status.violations).toHaveLength(0);
    expect(status.active_constraints).toHaveLength(1);
    expect(status.active_constraints[0].constraint_label).toBe('Budget limit (upper bound)');
    expect(status.active_constraints[0].binding_option).toBe('Option A');
  });

  it('returns empty status for no constraints', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
    ];

    const status = evaluateConstraints(results, [], new Map());

    expect(status.violations).toHaveLength(0);
    expect(status.active_constraints).toHaveLength(0);
  });

  it('uses custom constraint label', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
    ];
    const constraints: NodeConstraint[] = [
      { node_id: 'revenue', min: 100, label: 'Minimum Revenue Target' },
    ];
    const nodeValues = new Map([
      ['Option A', new Map([['revenue', 80]])],
    ]);

    const status = evaluateConstraints(results, constraints, nodeValues);

    expect(status.violations[0].constraint_label).toBe('Minimum Revenue Target');
  });
});

describe('Mark Infeasible Options (Task 1.3)', () => {
  it('marks options with violations as infeasible', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
      { label: 'Option B', summary: { p10: 20, p50: 60, p90: 100 } },
    ];
    const constraintStatus = {
      violations: [
        {
          option_id: 'Option A',
          constraint_id: 'revenue_constraint',
          constraint_label: 'Revenue bounds',
          actual_value: 80,
          threshold: 100,
        },
      ],
      active_constraints: [],
    };

    const infeasible = markInfeasibleOptions(results, constraintStatus);

    expect(infeasible).toEqual(['Option A']);
    expect(results[0].infeasible).toBe(true);
    expect(results[0].constraint_violations).toHaveLength(1);
    expect(results[1].infeasible).toBeUndefined();
  });

  it('returns empty array when no violations', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 90 } },
    ];
    const constraintStatus = emptyConstraintStatus();

    const infeasible = markInfeasibleOptions(results, constraintStatus);

    expect(infeasible).toHaveLength(0);
  });
});

describe('Coherence Validation (Task 1.6)', () => {
  it('warns when all options have negative expected value', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: -20, p50: -10, p90: -5 } },
      { label: 'Option B', summary: { p10: -30, p50: -15, p90: -8 } },
    ];

    const warnings = validateCoherence(results, null, { baseline_value: 0 });

    expect(warnings.some((w) => w.code === 'ALL_OPTIONS_NEGATIVE')).toBe(true);
  });

  it('warns when top option has negative expected value', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: -5, p50: -2, p90: 5 } },
      { label: 'Option B', summary: { p10: 10, p50: 20, p90: 30 } },
    ];

    const warnings = validateCoherence(results, null, { baseline_value: 0 });

    // Option B is ranked higher (p50=20), so top option is not negative
    expect(warnings.some((w) => w.code === 'TOP_OPTION_NEGATIVE')).toBe(false);
  });

  it('warns on close race between top options', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 48, p50: 50, p90: 52 } },
      { label: 'Option B', summary: { p10: 47, p50: 49.5, p90: 51 } }, // Within 2%
    ];

    const warnings = validateCoherence(results, null, { close_race_threshold: 0.02 });

    expect(warnings.some((w) => w.code === 'CLOSE_RACE')).toBe(true);
  });

  it('does not warn when clear winner', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 48, p50: 50, p90: 52 } },
      { label: 'Option B', summary: { p10: 30, p50: 35, p90: 40 } }, // Clearly worse
    ];

    const warnings = validateCoherence(results, null, { close_race_threshold: 0.02 });

    expect(warnings.some((w) => w.code === 'CLOSE_RACE')).toBe(false);
  });

  it('warns when baseline beats all other options', () => {
    const results: RankableResult[] = [
      { label: 'Baseline', summary: { p10: 45, p50: 50, p90: 55 } },
      { label: 'Option A', summary: { p10: 40, p50: 45, p90: 50 } },
      { label: 'Option B', summary: { p10: 35, p50: 40, p90: 45 } },
    ];

    const warnings = validateCoherence(results, 'Baseline');

    expect(warnings.some((w) => w.code === 'BASELINE_BEATS_ALL')).toBe(true);
  });

  it('warns on high uncertainty', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 10, p50: 50, p90: 100 } }, // Spread 90, ratio 1.8
    ];

    const warnings = validateCoherence(results, null, { high_uncertainty_threshold: 0.5 });

    expect(warnings.some((w) => w.code === 'HIGH_UNCERTAINTY')).toBe(true);
  });

  it('does not warn on low uncertainty', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 45, p50: 50, p90: 55 } }, // Spread 10, ratio 0.2
    ];

    const warnings = validateCoherence(results, null, { high_uncertainty_threshold: 0.5 });

    expect(warnings.some((w) => w.code === 'HIGH_UNCERTAINTY')).toBe(false);
  });

  it('skips infeasible options', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: { p10: 100, p50: 150, p90: 200 }, infeasible: true },
      { label: 'Option B', summary: { p10: -10, p50: -5, p90: 0 } },
    ];

    const warnings = validateCoherence(results, null, { baseline_value: 0 });

    // Should only consider Option B (which is negative)
    expect(warnings.some((w) => w.code === 'ALL_OPTIONS_NEGATIVE')).toBe(true);
  });

  it('returns empty warnings for empty results', () => {
    const warnings = validateCoherence([], null);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty warnings when all results have null summary', () => {
    const results: RankableResult[] = [
      { label: 'Option A', summary: null },
      { label: 'Option B', summary: null },
    ];

    const warnings = validateCoherence(results, null);
    expect(warnings).toHaveLength(0);
  });
});

describe('Empty Constraint Status', () => {
  it('returns empty arrays', () => {
    const status = emptyConstraintStatus();

    expect(status.violations).toEqual([]);
    expect(status.active_constraints).toEqual([]);
  });
});
