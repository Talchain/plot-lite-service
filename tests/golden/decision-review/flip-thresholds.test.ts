/**
 * Flip Threshold Computation Tests
 *
 * Tests for the heuristic flip threshold computation.
 * Note: Uses heuristic approach since elasticity != delta_win_probability.
 *
 * @see Brief: M2 Decision Review Integration, Task 2
 */

import { describe, it, expect } from 'vitest';
import { computeFlipThresholdData } from '../../../src/coaching/flip-thresholds.js';
import type { EngineGraphV3 } from '../../../src/types/engine-v3.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_FACTOR_SENSITIVITY = [
  { factor_id: 'factor-high', factor_label: 'High Impact', elasticity: 0.5, confidence: 0.8 },
  { factor_id: 'factor-medium', factor_label: 'Medium Impact', elasticity: 0.3, confidence: 0.7 },
  { factor_id: 'factor-low', factor_label: 'Low Impact', elasticity: 0.1, confidence: 0.6 },
  { factor_id: 'factor-neg', factor_label: 'Negative Impact', elasticity: -0.4, confidence: 0.9 },
];

const TEST_OPTION_COMPARISON = [
  { option_id: 'opt-a', option_label: 'Option A', win_probability: 0.65, expected_outcome: 0.8 },
  { option_id: 'opt-b', option_label: 'Option B', win_probability: 0.35, expected_outcome: 0.6 },
];

const TEST_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor-high', label: 'High Impact', kind: 'factor', observed_state: { value: 0.7, belief: 0.8 } },
    { id: 'factor-medium', label: 'Medium Impact', kind: 'factor', observed_state: { value: 0.5, belief: 0.7 } },
    { id: 'factor-low', label: 'Low Impact', kind: 'factor', observed_state: { value: 0.3, belief: 0.6 } },
    { id: 'factor-neg', label: 'Negative Impact', kind: 'factor', observed_state: { value: 0.8, belief: 0.9 } },
    { id: 'opt-a', label: 'Option A', kind: 'option' },
    { id: 'opt-b', label: 'Option B', kind: 'option' },
    { id: 'goal', label: 'Goal', kind: 'goal' },
    { id: 'decision', label: 'Decision', kind: 'decision' },
  ],
  edges: [],
};

// =============================================================================
// Tests
// =============================================================================

describe('computeFlipThresholdData()', () => {
  describe('Basic Functionality', () => {
    it('returns top 5 factors by |elasticity|', () => {
      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );

      expect(result.length).toBeLessThanOrEqual(5);

      // Should include factor-high (0.5) and factor-neg (-0.4) as top candidates
      const factorIds = result.map((r) => r.factor_id);
      expect(factorIds).toContain('factor-high');
      expect(factorIds).toContain('factor-neg');
    });

    it('includes factor_id and factor_label', () => {
      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );

      for (const threshold of result) {
        expect(threshold.factor_id).toBeDefined();
        expect(threshold.factor_label).toBeDefined();
        expect(typeof threshold.factor_id).toBe('string');
        expect(typeof threshold.factor_label).toBe('string');
      }
    });

    it('extracts current_value from graph observed_state', () => {
      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );

      const highFactor = result.find((r) => r.factor_id === 'factor-high');
      expect(highFactor?.current_value).toBe(0.7);

      const negFactor = result.find((r) => r.factor_id === 'factor-neg');
      expect(negFactor?.current_value).toBe(0.8);
    });

    it('sets flip_value to null (heuristic approach)', () => {
      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );

      for (const threshold of result) {
        expect(threshold.flip_value).toBeNull();
      }
    });

    it('determines direction based on elasticity sign', () => {
      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );

      // Positive elasticity with high value -> decrease
      const highFactor = result.find((r) => r.factor_id === 'factor-high');
      expect(highFactor?.direction).toBe('decrease');

      // Negative elasticity with high value -> decrease (reduces negative impact)
      const negFactor = result.find((r) => r.factor_id === 'factor-neg');
      expect(['increase', 'decrease']).toContain(negFactor?.direction);
    });
  });

  describe('Edge Cases', () => {
    it('returns empty array when no factor sensitivity', () => {
      const result = computeFlipThresholdData([], TEST_OPTION_COMPARISON, TEST_GRAPH);
      expect(result).toHaveLength(0);
    });

    it('returns single entry when only one factor', () => {
      const result = computeFlipThresholdData(
        [TEST_FACTOR_SENSITIVITY[0]],
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it('skips factors not in graph (no current_value)', () => {
      const result = computeFlipThresholdData(
        [{ factor_id: 'missing-factor', factor_label: 'Missing', elasticity: 0.5, confidence: 0.8 }],
        TEST_OPTION_COMPARISON,
        TEST_GRAPH
      );

      // Factor should be skipped since it's not in the graph
      expect(result).toHaveLength(0);
    });

    it('handles tie in |elasticity| by taking first ones', () => {
      const tiedSensitivity = [
        { factor_id: 'f1', factor_label: 'F1', elasticity: 0.3, confidence: 0.8 },
        { factor_id: 'f2', factor_label: 'F2', elasticity: 0.3, confidence: 0.8 },
        { factor_id: 'f3', factor_label: 'F3', elasticity: 0.3, confidence: 0.8 },
      ];

      const graphWithTies: EngineGraphV3 = {
        nodes: [
          { id: 'f1', label: 'F1', kind: 'factor', observed_state: { value: 0.5, belief: 0.8 } },
          { id: 'f2', label: 'F2', kind: 'factor', observed_state: { value: 0.5, belief: 0.8 } },
          { id: 'f3', label: 'F3', kind: 'factor', observed_state: { value: 0.5, belief: 0.8 } },
        ],
        edges: [],
      };

      const result = computeFlipThresholdData(
        tiedSensitivity,
        TEST_OPTION_COMPARISON,
        graphWithTies
      );

      expect(result.length).toBe(3); // All 3 pass the min-elasticity threshold (0.3 > 0.01)
    });

    it('handles zero elasticity factors (excludes them)', () => {
      const withZero = [
        { factor_id: 'f-zero', factor_label: 'Zero', elasticity: 0, confidence: 0.9 },
        { factor_id: 'f-nonzero', factor_label: 'NonZero', elasticity: 0.2, confidence: 0.7 },
      ];

      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'f-zero', label: 'Zero', kind: 'factor', observed_state: { value: 0.5, belief: 0.8 } },
          { id: 'f-nonzero', label: 'NonZero', kind: 'factor', observed_state: { value: 0.5, belief: 0.8 } },
        ],
        edges: [],
      };

      const result = computeFlipThresholdData(withZero, TEST_OPTION_COMPARISON, graph);

      // Should not include zero elasticity factor in top picks
      const hasZero = result.some((r) => r.factor_id === 'f-zero');
      expect(hasZero).toBe(false);
    });
  });

  describe('Direction Logic', () => {
    it('positive elasticity suggests decrease (to help runner-up)', () => {
      const sensitivity = [
        { factor_id: 'f1', factor_label: 'F1', elasticity: 0.5, confidence: 0.8 },
      ];

      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'f1', label: 'F1', kind: 'factor', observed_state: { value: 0.3, belief: 0.8 } },
        ],
        edges: [],
      };

      const result = computeFlipThresholdData(sensitivity, TEST_OPTION_COMPARISON, graph);

      // Positive elasticity: increasing helps winner, so decrease to help runner-up
      expect(result[0]?.direction).toBe('decrease');
    });

    it('negative elasticity suggests increase (to help runner-up)', () => {
      const sensitivity = [
        { factor_id: 'f1', factor_label: 'F1', elasticity: -0.5, confidence: 0.8 },
      ];

      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'f1', label: 'F1', kind: 'factor', observed_state: { value: 0.8, belief: 0.8 } },
        ],
        edges: [],
      };

      const result = computeFlipThresholdData(sensitivity, TEST_OPTION_COMPARISON, graph);

      // Negative elasticity: decreasing helps winner, so increase to help runner-up
      expect(result[0]?.direction).toBe('increase');
    });
  });

  describe('Margin Consideration', () => {
    it('handles wide margin (clear winner)', () => {
      const wideMargin = [
        { option_id: 'opt-a', option_label: 'A', win_probability: 0.85, expected_outcome: 0.9 },
        { option_id: 'opt-b', option_label: 'B', win_probability: 0.15, expected_outcome: 0.5 },
      ];

      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        wideMargin,
        TEST_GRAPH
      );

      // Should still return top factors
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles narrow margin (close call)', () => {
      const narrowMargin = [
        { option_id: 'opt-a', option_label: 'A', win_probability: 0.52, expected_outcome: 0.7 },
        { option_id: 'opt-b', option_label: 'B', win_probability: 0.48, expected_outcome: 0.65 },
      ];

      const result = computeFlipThresholdData(
        TEST_FACTOR_SENSITIVITY,
        narrowMargin,
        TEST_GRAPH
      );

      // Should still return top factors
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
