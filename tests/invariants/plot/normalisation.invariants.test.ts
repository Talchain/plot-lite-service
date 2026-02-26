/**
 * Normalisation Invariants Test Stubs
 *
 * Tests for SSOT v1.2 invariant contracts on graph normalisation.
 * These tests verify that normalisation operations maintain required bounds.
 *
 * @see docs/audits/PLOT_OPERATIONS_INVENTORY.md
 */
import { describe, it, expect } from 'vitest';
import {
  normaliseGraph,
  normaliseNode,
  normaliseEdge,
  deriveStd,
} from '../../../src/normalisation/graph-normaliser.js';
import { REPAIR_CODES } from '../../../src/normalisation/repair-codes.js';
import type { EngineGraphV3 } from '../../../src/types/engine-v3.js';

// -----------------------------------------------------------------------------
// Constants (from graph-normaliser.ts)
// -----------------------------------------------------------------------------
const DEFAULT_EXISTS_PROBABILITY = 0.8;
const MIN_STD = 0.001;
const STD_RANGE_MIN = 0.05;
const STD_RANGE_MAX = 0.4;

// -----------------------------------------------------------------------------
// INV-NORM-01: exists_probability bounded [0, 1]
// -----------------------------------------------------------------------------
describe('INV-NORM-01: exists_probability bounded [0, 1]', () => {
  it('clamps exists_probability above 1 to 1', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      []
    );
    expect(edge.exists_probability).toBe(1);
  });

  it('clamps exists_probability below 0 to 0', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', exists_probability: -0.5, weight: 0.5 },
      0,
      new Map(),
      []
    );
    expect(edge.exists_probability).toBe(0);
  });

  it('defaults missing exists_probability to 0.8', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', weight: 0.5 },
      0,
      new Map(),
      []
    );
    expect(edge.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY);
  });

  it('preserves valid exists_probability', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 0.75, weight: 0.5 },
      0,
      new Map(),
      []
    );
    expect(edge.exists_probability).toBe(0.75);
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-02: strength.mean bounded [-1, 1]
// -----------------------------------------------------------------------------
describe('INV-NORM-02: strength.mean bounded [-1, 1]', () => {
  it('clamps strength.mean above 1 to 1', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 1.5, std: 0.1 } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.mean).toBe(1);
  });

  it('clamps strength.mean below -1 to -1', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: -1.5, std: 0.1 } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.mean).toBe(-1);
  });

  it('preserves valid negative strength.mean', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: -0.7, std: 0.1 } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.mean).toBe(-0.7);
  });

  it('derives strength.mean from weight with positive direction', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', weight: 0.8, effect_direction: 'positive' },
      0,
      new Map(),
      []
    );
    expect(edge.strength.mean).toBe(0.8);
  });

  it('derives strength.mean from weight with negative direction', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', weight: 0.8, effect_direction: 'negative' },
      0,
      new Map(),
      []
    );
    expect(edge.strength.mean).toBe(-0.8);
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-03: strength.std bounded [MIN_STD, STD_RANGE_MAX]
// -----------------------------------------------------------------------------
describe('INV-NORM-03: strength.std bounded [0.001, 0.4]', () => {
  it('clamps strength.std above 0.4 to 0.4', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 0.5, std: 0.8 } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.std).toBe(STD_RANGE_MAX);
  });

  it('clamps causal edge strength.std below 0.05 to 0.05', () => {
    // Causal edge (factor → outcome)
    const nodeKindMap = new Map([
      ['factor_a', 'factor'],
      ['outcome_b', 'outcome'],
    ]);
    const edge = normaliseEdge(
      { from: 'factor_a', to: 'outcome_b', strength: { mean: 0.5, std: 0.01 } },
      0,
      nodeKindMap,
      []
    );
    expect(edge.strength.std).toBe(STD_RANGE_MIN); // 0.05
  });

  it('allows structural edge strength.std of 0.01 (decision → option)', () => {
    // Structural edge: decision → option
    const nodeKindMap = new Map([
      ['dec_1', 'decision'],
      ['opt_1', 'option'],
    ]);
    const edge = normaliseEdge(
      { from: 'dec_1', to: 'opt_1', strength: { mean: 1.0, std: 0.01 } },
      0,
      nodeKindMap,
      []
    );
    expect(edge.strength.std).toBe(0.01); // Not clamped to 0.05
  });

  it('allows structural edge strength.std of 0.01 (option → factor)', () => {
    // Structural edge: option → factor
    const nodeKindMap = new Map([
      ['opt_1', 'option'],
      ['fac_1', 'factor'],
    ]);
    const edge = normaliseEdge(
      { from: 'opt_1', to: 'fac_1', strength: { mean: 1.0, std: 0.01 } },
      0,
      nodeKindMap,
      []
    );
    expect(edge.strength.std).toBe(0.01); // Not clamped to 0.05
  });

  it('floors zero strength.std to MIN_STD', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 0.5, std: 0 } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.std).toBe(STD_RANGE_MIN);
  });

  it('preserves valid strength.std', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 0.5, std: 0.2 } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.std).toBe(0.2);
  });

  it('handles NaN strength.std by flooring', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 0.5, std: NaN } },
      0,
      new Map(),
      []
    );
    expect(edge.strength.std).toBeGreaterThanOrEqual(STD_RANGE_MIN);
    expect(Number.isFinite(edge.strength.std)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-04: deriveStd produces valid values
// -----------------------------------------------------------------------------
describe('INV-NORM-04: deriveStd produces valid values', () => {
  it('produces std >= 0.05 for any mean and belief', () => {
    const testCases = [
      { mean: 0, belief: 1 },
      { mean: 0.5, belief: 0 },
      { mean: 1, belief: 0.5 },
      { mean: -0.8, belief: 0.9 },
    ];

    for (const { mean, belief } of testCases) {
      const std = deriveStd(mean, belief);
      expect(std).toBeGreaterThanOrEqual(0.05);
    }
  });

  it('produces higher std for lower belief', () => {
    const highBelief = deriveStd(0.5, 0.9);
    const lowBelief = deriveStd(0.5, 0.1);
    expect(lowBelief).toBeGreaterThan(highBelief);
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-05: Idempotency - normalisation is idempotent
// -----------------------------------------------------------------------------
describe('INV-NORM-05: Normalisation idempotency', () => {
  it('normaliseGraph is idempotent on already-normalised graph', () => {
    const inputGraph = {
      nodes: [
        { id: 'A', kind: 'factor', label: 'Factor A' },
        { id: 'B', kind: 'goal', label: 'Goal B' },
      ],
      edges: [
        { from: 'A', to: 'B', weight: 0.7, belief: 0.9 },
      ],
    };

    const first = normaliseGraph(inputGraph);
    const second = normaliseGraph(first.graph as any);

    // Second normalisation should produce identical graph
    expect(second.graph.nodes).toEqual(first.graph.nodes);
    expect(second.graph.edges).toEqual(first.graph.edges);
  });

  it('normalised edges have stable coefficients on re-normalisation', () => {
    const edge = normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 0.5, std: 0.2 }, exists_probability: 0.9 },
      0,
      new Map(),
      []
    );

    const renormalized = normaliseEdge(
      { from: edge.from, to: edge.to, strength: edge.strength, exists_probability: edge.exists_probability },
      0,
      new Map(),
      []
    );

    expect(renormalized.strength.mean).toBe(edge.strength.mean);
    expect(renormalized.strength.std).toBe(edge.strength.std);
    expect(renormalized.exists_probability).toBe(edge.exists_probability);
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-06: Repair warnings emitted
// -----------------------------------------------------------------------------
describe('INV-NORM-06: Repair warnings are emitted', () => {
  it('emits CLAMP_EXISTS_PROBABILITY for clamped exists_probability', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    const repairWarning = warnings.find(w => w.code === REPAIR_CODES.CLAMP_EXISTS_PROBABILITY);
    expect(repairWarning).toBeDefined();
    expect(repairWarning.message).toContain('clamped');
  });

  it('emits DEFAULT_STRENGTH_STD for defaulted strength.std', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    const repairWarning = warnings.find(w =>
      w.code === REPAIR_CODES.DEFAULT_STRENGTH_STD && w.message.includes('strength.std')
    );
    expect(repairWarning).toBeDefined();
  });

  it('emits INFER_EFFECT_DIRECTION for risk→goal edge', () => {
    const warnings: any[] = [];
    const nodeKindMap = new Map([
      ['risk_node', 'risk'],
      ['goal_node', 'goal'],
    ]);

    normaliseEdge(
      { from: 'risk_node', to: 'goal_node', weight: 0.5 },
      0,
      nodeKindMap,
      warnings
    );

    const inferWarning = warnings.find(w => w.code === REPAIR_CODES.INFER_EFFECT_DIRECTION);
    expect(inferWarning).toBeDefined();
    expect(inferWarning.message).toContain('negative');
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-07: Node intercept validation
// -----------------------------------------------------------------------------
describe('INV-NORM-07: Node intercept validation', () => {
  it('rejects null intercept with NormalisationError', () => {
    expect(() => {
      normaliseNode({ id: 'A', kind: 'factor', intercept: null as any }, []);
    }).toThrow('intercept cannot be null');
  });

  it('accepts undefined intercept', () => {
    const node = normaliseNode({ id: 'A', kind: 'factor' }, []);
    expect(node.intercept).toBeUndefined();
  });

  it('accepts finite number intercept', () => {
    const node = normaliseNode({ id: 'A', kind: 'factor', intercept: 0.5 }, []);
    expect(node.intercept).toBe(0.5);
  });

  it('rejects NaN intercept with NormalisationError', () => {
    expect(() => {
      normaliseNode({ id: 'A', kind: 'factor', intercept: NaN }, []);
    }).toThrow('intercept must be a finite number');
  });
});

// -----------------------------------------------------------------------------
// INV-NORM-08: Repair records contain correct structure
// -----------------------------------------------------------------------------
describe('INV-NORM-08: Repair records contain correct structure', () => {
  it('clamped exists_probability has correct from/to values', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    const repairWarning = warnings.find(w =>
      w.code === REPAIR_CODES.CLAMP_EXISTS_PROBABILITY &&
      w.repair?.field === 'edge.exists_probability'
    );
    expect(repairWarning).toBeDefined();
    expect(repairWarning.repair).toEqual({
      field: 'edge.exists_probability',
      action: 'clamped',
      from_value: 1.5,
      to_value: 1,
      reason: 'Value exceeded valid range [0, 1]',
    });
  });

  it('clamped strength.mean has correct from/to values', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 1.5, std: 0.1 } },
      0,
      new Map(),
      warnings
    );

    const repairWarning = warnings.find(w =>
      w.code === REPAIR_CODES.CLAMP_STRENGTH_MEAN &&
      w.repair?.field === 'edge.strength.mean'
    );
    expect(repairWarning).toBeDefined();
    expect(repairWarning.repair).toEqual({
      field: 'edge.strength.mean',
      action: 'clamped',
      from_value: 1.5,
      to_value: 1,
      reason: 'Value exceeded valid range [-1, 1]',
    });
  });

  it('clamped strength.std has correct from/to values', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', strength: { mean: 0.5, std: 0.8 } },
      0,
      new Map(),
      warnings
    );

    const repairWarning = warnings.find(w =>
      w.code === REPAIR_CODES.CLAMP_STRENGTH_STD &&
      w.repair?.field === 'edge.strength.std'
    );
    expect(repairWarning).toBeDefined();
    expect(repairWarning.repair).toEqual({
      field: 'edge.strength.std',
      action: 'clamped',
      from_value: 0.8,
      to_value: 0.4,
      reason: 'Value exceeded valid range [0.05, 0.4]',
    });
  });

  it('derived strength.std has correct from/to values', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', weight: 0.5, belief: 0.9 },
      0,
      new Map(),
      warnings
    );

    const repairWarning = warnings.find(w =>
      w.code === REPAIR_CODES.DEFAULT_STRENGTH_STD &&
      w.repair?.field === 'edge.strength.std' &&
      w.repair?.action === 'derived'
    );
    expect(repairWarning).toBeDefined();
    expect(repairWarning.repair.from_value).toBeNull();
    expect(repairWarning.repair.to_value).toBeGreaterThanOrEqual(0.05);
    expect(repairWarning.repair.to_value).toBeLessThanOrEqual(0.4);
    expect(repairWarning.repair.reason).toBe('Missing value, derived from mean and belief');
  });

  it('direction inference has correct repair record', () => {
    const warnings: any[] = [];
    const nodeKindMap = new Map([
      ['risk_node', 'risk'],
      ['goal_node', 'goal'],
    ]);

    normaliseEdge(
      { from: 'risk_node', to: 'goal_node', weight: 0.5 },
      0,
      nodeKindMap,
      warnings
    );

    const inferWarning = warnings.find(w => w.code === REPAIR_CODES.INFER_EFFECT_DIRECTION);
    expect(inferWarning).toBeDefined();
    expect(inferWarning.repair).toEqual({
      field: 'edge.effect_direction',
      action: 'inferred',
      from_value: null,
      to_value: 'negative',
      reason: "Inferred from source node kind 'risk'",
    });
  });

  it('multiple repairs are all captured', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    // Should have repairs for: exists_probability (clamped) and strength.std (derived)
    const repairWarnings = warnings.filter(w => w.repair !== undefined);
    expect(repairWarnings.length).toBeGreaterThanOrEqual(2);

    const fields = repairWarnings.map(w => w.repair.field);
    expect(fields).toContain('edge.exists_probability');
    expect(fields).toContain('edge.strength.std');
  });

  it('all repair records have a reason field', () => {
    const warnings: any[] = [];
    normaliseEdge(
      { from: 'A', to: 'B', exists_probability: 1.5, weight: 0.5 },
      0,
      new Map(),
      warnings
    );

    const repairWarnings = warnings.filter(w => w.repair !== undefined);
    for (const warning of repairWarnings) {
      expect(warning.repair.reason).toBeDefined();
      expect(typeof warning.repair.reason).toBe('string');
      expect(warning.repair.reason.length).toBeGreaterThan(0);
    }
  });
});
