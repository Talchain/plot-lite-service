/**
 * Temporal Constraint Filter Tests
 *
 * Verifies that non-evaluable temporal constraints are filtered before ISL.
 * ISL evaluates constraints via Monte Carlo on static causal graphs;
 * temporal constraints ("achieve X within 6 months") produce trivial P=1.0.
 *
 * Tests:
 * - T1: deadline_metadata present → filtered
 * - T2: temporal unit on goal node with value > 1 → filtered
 * - T3: legitimate goal constraint (no temporal markers) → NOT filtered
 * - T4: factor constraint → NOT filtered (not probability-domain node)
 * - T5a/T5b: '%'-united constraints (P0-C1) — within [0,100] = in-domain
 *   (scale resolved, no warning); beyond the cap → still warns
 * - T6: mixed array → correct split
 * - T7: empty array → no-op
 * - T8: unknown node_id → passed through (let validation catch it)
 * - T9: CEE-specific fields stripped from passed constraints
 */

import { describe, it, expect, vi } from 'vitest';
import type { EngineNodeV3 } from '../src/types/engine-v3.js';
import type { RawGoalConstraint } from '../src/types/engine-v3.js';
import { filterTemporalConstraints } from '../src/normalisation/constraint-filter.js';

// -----------------------------------------------------------------------------
// Test Fixtures
// -----------------------------------------------------------------------------

const GOAL_NODE: EngineNodeV3 = {
  id: 'goal_mid_market_success',
  kind: 'goal',
  label: 'Mid-Market Success',
} as EngineNodeV3;

const OUTCOME_NODE: EngineNodeV3 = {
  id: 'outcome_retention',
  kind: 'outcome',
  label: 'Customer Retention',
} as EngineNodeV3;

const RISK_NODE: EngineNodeV3 = {
  id: 'risk_churn',
  kind: 'risk',
  label: 'Churn Risk',
} as EngineNodeV3;

const FACTOR_NODE: EngineNodeV3 = {
  id: 'fac_customer_churn',
  kind: 'factor',
  label: 'Customer Churn',
  observed_state: { value: 0.04 },
} as EngineNodeV3;

const ALL_NODES = [GOAL_NODE, OUTCOME_NODE, RISK_NODE, FACTOR_NODE];

function mockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('filterTemporalConstraints', () => {
  // T1: deadline_metadata present → filtered (temporal_deadline)
  it('T1: filters constraint with deadline_metadata present', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c1',
      node_id: 'goal_mid_market_success',
      operator: '<=',
      value: 12,
      deadline_metadata: { deadline: '2026-06-01', source: 'cee' },
    }];
    const logger = mockLogger();
    const result = filterTemporalConstraints(constraints, ALL_NODES, logger);

    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0]).toEqual({
      constraint_id: 'c1',
      node_id: 'goal_mid_market_success',
      reason: 'temporal_deadline',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'plot.constraint_filtered',
        constraint_id: 'c1',
        reason: 'temporal_deadline',
      })
    );
  });

  // T2: temporal unit on goal node with value > 1 → filtered
  it('T2: filters temporal constraint on goal node (value > 1, unit = months)', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c2',
      node_id: 'goal_mid_market_success',
      operator: '<=',
      value: 12,
      unit: 'months',
    }];
    const logger = mockLogger();
    const result = filterTemporalConstraints(constraints, ALL_NODES, logger);

    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0]).toEqual({
      constraint_id: 'c2',
      node_id: 'goal_mid_market_success',
      reason: 'temporal_against_normalised_goal',
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'plot.constraint_filtered',
        reason: 'temporal_against_normalised_goal',
        value: 12,
        unit: 'months',
      })
    );
  });

  // T3: legitimate goal constraint (value in [0,1], no temporal markers) → NOT filtered
  it('T3: does NOT filter legitimate goal constraint (value 0.8, no temporal markers)', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c3',
      node_id: 'goal_mid_market_success',
      operator: '>=',
      value: 0.8,
    }];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.passed[0].constraint_id).toBe('c3');
  });

  // T4: factor constraint → NOT filtered (factor is not a probability-domain node)
  it('T4: does NOT filter factor constraint (fac_customer_churn <= 0.04)', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c4',
      node_id: 'fac_customer_churn',
      operator: '<=',
      value: 0.04,
    }];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
    expect(result.passed[0].constraint_id).toBe('c4');
  });

  // T5 (updated for P0-C1): a '%' unit is a producer-declared scale (house
  // doctrine: '%' normalises against 100), so a '%' value within [0,100] is
  // IN-domain — the gate resolves the scale instead of warning. The original
  // intent (flag values that cannot be scaled into the domain) is preserved:
  // a '%' value beyond the cap still warns.
  it("T5a: does NOT warn for a '%' value within the declared scale (1.1% is in-domain)", () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c5',
      node_id: 'goal_mid_market_success',
      operator: '>=',
      value: 1.1,
      unit: '%',
    }];
    const logger = mockLogger();
    const result = filterTemporalConstraints(constraints, ALL_NODES, logger);

    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'plot.constraint_scale_resolved',
        constraint_id: 'c5',
        threshold: 1.1,
        declared_cap: 100,
      })
    );
  });

  it("T5b: STILL warns for a '%' value beyond the declared cap (150%)", () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c5',
      node_id: 'goal_mid_market_success',
      operator: '>=',
      value: 150,
      unit: '%',
    }];
    const logger = mockLogger();
    const result = filterTemporalConstraints(constraints, ALL_NODES, logger);

    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toEqual(expect.objectContaining({
      constraint_id: 'c5',
      node_id: 'goal_mid_market_success',
      threshold: 150,
      node_kind: 'goal',
    }));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'plot.constraint_out_of_domain',
        constraint_id: 'c5',
        threshold: 150,
      })
    );
  });

  // T6: mixed array — 2 temporal + 2 evaluable → correct split
  it('T6: splits mixed array correctly (2 passed, 2 filtered)', () => {
    const constraints: RawGoalConstraint[] = [
      // Evaluable: goal constraint in [0,1]
      { constraint_id: 'ok1', node_id: 'goal_mid_market_success', operator: '>=', value: 0.8 },
      // Temporal: goal node + value > 1 + temporal unit
      { constraint_id: 'drop1', node_id: 'goal_mid_market_success', operator: '<=', value: 6, unit: 'months' },
      // Evaluable: factor constraint
      { constraint_id: 'ok2', node_id: 'fac_customer_churn', operator: '<=', value: 0.04 },
      // Temporal: deadline_metadata present
      { constraint_id: 'drop2', node_id: 'risk_churn', operator: '<=', value: 0.3, deadline_metadata: { d: 1 } },
    ];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    expect(result.passed).toHaveLength(2);
    expect(result.filtered).toHaveLength(2);
    expect(result.passed.map(c => c.constraint_id)).toEqual(['ok1', 'ok2']);
    expect(result.filtered.map(c => c.constraint_id)).toEqual(['drop1', 'drop2']);
  });

  // T7: empty array → no-op
  it('T7: handles empty constraints array', () => {
    const result = filterTemporalConstraints([], ALL_NODES);

    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  // T8: unknown node_id → passed through (downstream validation will catch it)
  it('T8: passes constraint with unknown node_id (let validation catch it)', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c8',
      node_id: 'missing_node',
      operator: '>=',
      value: 6,
      unit: 'months',
    }];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    // node_id not found → kind is 'unknown' → not in PROBABILITY_DOMAIN_KINDS
    // → drop rule 2 does not fire → constraint passes through
    // Downstream validateGoalConstraints will emit CONSTRAINT_TARGET_NOT_FOUND
    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
  });

  // T9: CEE-specific fields (deadline_metadata, unit) stripped from passed constraints
  it('T9: strips CEE-specific fields from passed constraints', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c9',
      node_id: 'fac_customer_churn',
      operator: '<=',
      value: 0.04,
      unit: 'ratio',
      label: 'Keep churn low',
      weight: 0.5,
    }];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    expect(result.passed).toHaveLength(1);
    const passed = result.passed[0];
    expect(passed).toEqual({
      constraint_id: 'c9',
      node_id: 'fac_customer_churn',
      operator: '<=',
      value: 0.04,
      label: 'Keep churn low',
      weight: 0.5,
    });
    // Ensure no CEE-specific fields leak through
    expect(passed).not.toHaveProperty('unit');
    expect(passed).not.toHaveProperty('deadline_metadata');
  });

  // Edge case: temporal unit variants (singular, case-insensitive)
  it('handles singular temporal units (day, week, year)', () => {
    const constraints: RawGoalConstraint[] = [
      { constraint_id: 'c10', node_id: 'outcome_retention', operator: '<=', value: 30, unit: 'Day' },
      { constraint_id: 'c11', node_id: 'risk_churn', operator: '<=', value: 2, unit: 'YEARS' },
    ];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(2);
  });

  // Edge case: value exactly 1.0 with temporal unit on goal node → NOT filtered
  // (value must be > 1.0, not >= 1.0)
  it('does not filter value=1.0 even with temporal unit on goal node', () => {
    const constraints: RawGoalConstraint[] = [{
      constraint_id: 'c12',
      node_id: 'goal_mid_market_success',
      operator: '<=',
      value: 1.0,
      unit: 'months',
    }];
    const result = filterTemporalConstraints(constraints, ALL_NODES);

    expect(result.passed).toHaveLength(1);
    expect(result.filtered).toHaveLength(0);
  });
});
