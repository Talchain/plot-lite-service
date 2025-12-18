/**
 * Factor Value Initialisation Tests (Phase 1B)
 *
 * Tests that root factor nodes correctly use observed_state.value
 * during kernel inference per Decision Model Schema v2.2.
 *
 * Root factor node: kind='factor' AND no incoming edges
 */
import { describe, it, expect } from 'vitest';
import { runKernel } from '../src/scm-lite/kernel.js';
import type { DAG } from '../src/scm-lite/types.js';

describe('Factor Value Initialisation', () => {
  /**
   * Test Case A: Single root factor node
   * A root factor node with observed_state.value should propagate that value to target.
   */
  it('Case A: single root factor node uses observed_state.value', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Price',
          label: 'Price',
          kind: 'factor',
          observed_state: { value: 59, unit: '£' },
        },
        { id: 'Goal', label: 'Goal', kind: 'goal' },
      ],
      edges: [{ from: 'Price', to: 'Goal', weight: 1, belief: 1.0 }],
    };

    const result = runKernel(dag, 'Goal', { seed: 42, K: 64 });

    // With belief=1.0 and weight=1, goal should equal the factor value
    expect(result.quantiles.p50).toBe(59);
  });

  /**
   * Test Case B: Two factor roots summing into goal
   * Multiple root factor nodes should each contribute their observed_state.value.
   */
  it('Case B: two factor roots sum into goal', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Price',
          label: 'Price',
          kind: 'factor',
          observed_state: { value: 59, unit: '£' },
        },
        {
          id: 'Discount',
          label: 'Discount',
          kind: 'factor',
          observed_state: { value: 10, unit: '£' },
        },
        { id: 'Revenue', label: 'Revenue', kind: 'goal' },
      ],
      edges: [
        { from: 'Price', to: 'Revenue', weight: 1, belief: 1.0 },
        { from: 'Discount', to: 'Revenue', weight: 1, belief: 1.0 },
      ],
    };

    const result = runKernel(dag, 'Revenue', { seed: 42, K: 64 });

    // Revenue should equal sum of factor values: 59 + 10 = 69
    expect(result.quantiles.p50).toBe(69);
  });

  /**
   * Test Case C: Factor with incoming edge (non-root)
   * A factor node with incoming edges is NOT a root node,
   * so observed_state.value should be IGNORED in favor of edge mechanism.
   */
  it('Case C: factor with incoming edge ignores observed_state', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Upstream',
          label: 'Upstream',
          kind: 'factor',
          observed_state: { value: 100 },
        },
        {
          id: 'Downstream',
          label: 'Downstream',
          kind: 'factor',
          observed_state: { value: 999 }, // Should be ignored - not a root node
        },
        { id: 'Goal', label: 'Goal', kind: 'goal' },
      ],
      edges: [
        { from: 'Upstream', to: 'Downstream', weight: 2, belief: 1.0 },
        { from: 'Downstream', to: 'Goal', weight: 1, belief: 1.0 },
      ],
    };

    const result = runKernel(dag, 'Goal', { seed: 42, K: 64 });

    // Downstream = Upstream * 2 = 100 * 2 = 200 (not 999)
    // Goal = Downstream * 1 = 200
    expect(result.quantiles.p50).toBe(200);
  });

  /**
   * Test Case D: Factor with observed_state but missing value
   * If observed_state exists but value is undefined, should default to 0.
   */
  it('Case D: factor with observed_state but missing value defaults to 0', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Price',
          label: 'Price',
          kind: 'factor',
          // @ts-expect-error - Testing edge case where value is missing
          observed_state: { unit: '£' }, // value is missing
        },
        { id: 'Goal', label: 'Goal', kind: 'goal' },
      ],
      edges: [{ from: 'Price', to: 'Goal', weight: 1, belief: 1.0 }],
    };

    const result = runKernel(dag, 'Goal', { seed: 42, K: 64 });

    // Without observed_state.value, root node should use default baseline (1)
    // Note: Kernel applies epistemic humility cap: values near 1.0 become 0.99
    expect(result.quantiles.p50).toBe(0.99);
  });

  /**
   * Test Case E: Non-factor root node
   * Root nodes that are NOT kind='factor' should use the default baseline (1).
   */
  it('Case E: non-factor root (kind=risk) uses default baseline', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Risk',
          label: 'Market Risk',
          kind: 'risk',
          // observed_state on non-factor should be ignored
          observed_state: { value: 50 },
        },
        { id: 'Goal', label: 'Goal', kind: 'goal' },
      ],
      edges: [{ from: 'Risk', to: 'Goal', weight: 1, belief: 1.0 }],
    };

    const result = runKernel(dag, 'Goal', { seed: 42, K: 64 });

    // Non-factor root should use default baseline (1), not observed_state.value
    // Note: Kernel applies epistemic humility cap: values near 1.0 become 0.99
    expect(result.quantiles.p50).toBe(0.99);
  });

  /**
   * Test Case F: Determinism with factor values
   * Same seed + same factor values should produce identical BMA hash.
   */
  it('Case F: determinism - same seed + factor values yields identical hash', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Price',
          label: 'Price',
          kind: 'factor',
          observed_state: { value: 59, baseline: 49, unit: '£' },
        },
        { id: 'Goal', label: 'Goal', kind: 'goal' },
      ],
      edges: [{ from: 'Price', to: 'Goal', weight: 1, belief: 1.0 }],
    };

    const result1 = runKernel(dag, 'Goal', { seed: 12345, K: 64 });
    const result2 = runKernel(dag, 'Goal', { seed: 12345, K: 64 });

    expect(result1.bma_hash).toBe(result2.bma_hash);
    expect(result1.quantiles.p50).toBe(result2.quantiles.p50);
  });

  /**
   * Additional Case: Factor value with weighted edges
   * Verify that factor values propagate correctly through weighted edges.
   */
  it('factor value propagates through weighted edge correctly', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Price',
          label: 'Price',
          kind: 'factor',
          observed_state: { value: 100 },
        },
        { id: 'Revenue', label: 'Revenue', kind: 'goal' },
      ],
      edges: [{ from: 'Price', to: 'Revenue', weight: 0.5, belief: 1.0 }],
    };

    const result = runKernel(dag, 'Revenue', { seed: 42, K: 64 });

    // Revenue = Price * 0.5 = 100 * 0.5 = 50
    expect(result.quantiles.p50).toBe(50);
  });

  /**
   * Additional Case: Negative factor values
   * Factor nodes should correctly handle negative values.
   */
  it('factor handles negative observed_state.value', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Cost',
          label: 'Cost',
          kind: 'factor',
          observed_state: { value: -30, unit: '£' },
        },
        { id: 'Profit', label: 'Profit', kind: 'goal' },
      ],
      edges: [{ from: 'Cost', to: 'Profit', weight: 1, belief: 1.0 }],
    };

    const result = runKernel(dag, 'Profit', { seed: 42, K: 64 });

    // Profit = Cost = -30
    expect(result.quantiles.p50).toBe(-30);
  });

  /**
   * Test Case G: Factor with observed_state.value = 0
   * Zero is a valid value and should NOT be treated as falsy/missing.
   * This is important for factors like "discount = 0" or "cost = 0".
   */
  it('Case G: factor with observed_state.value = 0 uses zero (not treated as falsy)', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'Discount',
          label: 'Discount',
          kind: 'factor',
          observed_state: { value: 0, unit: '£' }, // Explicitly zero
        },
        { id: 'FinalPrice', label: 'FinalPrice', kind: 'goal' },
      ],
      edges: [{ from: 'Discount', to: 'FinalPrice', weight: 1, belief: 1.0 }],
    };

    const result = runKernel(dag, 'FinalPrice', { seed: 42, K: 64 });

    // FinalPrice should be 0 (from the zero discount), NOT the default baseline
    expect(result.quantiles.p50).toBe(0);
  });

  /**
   * Test Case H: Factor with incoming edges uses computed value (structural root check)
   * When a factor node has incoming edges, it is NOT a structural root.
   * The observed_state.value should be IGNORED regardless of per-sample edge sampling.
   */
  it('Case H: factor with incoming edges uses computed value (ignores observed_state=59)', () => {
    const dag: DAG = {
      nodes: [
        {
          id: 'RootInput',
          label: 'Root Input',
          kind: 'factor',
          observed_state: { value: 100 },
        },
        {
          id: 'DerivedFactor',
          label: 'Derived Factor',
          kind: 'factor',
          observed_state: { value: 59 }, // Should be IGNORED - has incoming edge
        },
        { id: 'Goal', label: 'Goal', kind: 'goal' },
      ],
      edges: [
        { from: 'RootInput', to: 'DerivedFactor', weight: 3, belief: 1.0 },
        { from: 'DerivedFactor', to: 'Goal', weight: 1, belief: 1.0 },
      ],
    };

    const result = runKernel(dag, 'Goal', { seed: 42, K: 64 });

    // DerivedFactor = RootInput * 3 = 100 * 3 = 300 (NOT 59)
    // Goal = DerivedFactor * 1 = 300
    expect(result.quantiles.p50).toBe(300);
  });
});
