import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../src/trust/confidence.js';
import { buildCritique } from '../src/trust/critique-builder.js';
import { checkLinearity, detectThresholdCrossings } from '../src/trust/linearity.js';
import { buildExplainDelta } from '../src/trust/explain-delta.js';
import { checkIdentifiability } from '../src/trust/identifiability.js';
import type { Graph } from '../src/trust/types.js';

describe('Trust Signals - Unit Tests', () => {
  const simpleGraph: Graph = {
    nodes: [
      { id: 'n1', label: 'Input' },
      { id: 'n2', label: 'Process' },
      { id: 'n3', label: 'Output' },
    ],
    edges: [
      { from: 'n1', to: 'n2', weight: 0.8 },
      { from: 'n2', to: 'n3', weight: 0.9 },
    ],
  };

  describe('Confidence Badge', () => {
    it('returns HIGH for strong graph', () => {
      const confidence = calculateConfidence({
        graph: simpleGraph,
        identifiable: true,
        in_linear_range: true,
        k_samples: 1000,
        calibrated: false,
      });

      expect(confidence.level).toBe('high');
      expect(confidence.score).toBeGreaterThan(0.7);
      expect(confidence.reason).toBeDefined();
      expect(confidence.factors.identifiability).toBe(1.0);
    });

    it('returns LOW for weak graph', () => {
      const weakGraph: Graph = {
        nodes: [{ id: 'n1', label: 'Alone' }],
        edges: [],
      };

      const confidence = calculateConfidence({
        graph: weakGraph,
        identifiable: false,
        in_linear_range: false,
        k_samples: 100,
      });

      expect(confidence.level).toBe('low');
      expect(confidence.score).toBeLessThan(0.5);
      expect(confidence.reason).toContain('Low confidence');
    });

    it('returns MEDIUM for acceptable graph', () => {
      const confidence = calculateConfidence({
        graph: simpleGraph,
        identifiable: true,
        in_linear_range: false,
        k_samples: 500,
      });

      expect(confidence.level).toBe('medium');
      expect(confidence.score).toBeGreaterThanOrEqual(0.5);
      expect(confidence.score).toBeLessThan(0.75);
    });
  });

  describe('Critique Builder', () => {
    it('flags oversized graphs', () => {
      const largeGraph: Graph = {
        nodes: Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
        edges: [],
      };

      const critique = buildCritique({
        graph: largeGraph,
        identifiable: true,
        node_limit: 12,
      });

      const blocker = critique.find(c => c.severity === 'BLOCKER');
      expect(blocker).toBeDefined();
      expect(blocker?.message).toContain('too large');
    });

    it('flags non-identifiable models', () => {
      const critique = buildCritique({
        graph: simpleGraph,
        identifiable: false,
      });

      const blocker = critique.find(c => c.message.includes('not identifiable'));
      expect(blocker).toBeDefined();
      expect(blocker?.severity).toBe('BLOCKER');
    });

    it('detects disconnected nodes', () => {
      const disconnectedGraph: Graph = {
        nodes: [
          { id: 'n1', label: 'Connected A' },
          { id: 'n2', label: 'Connected B' },
          { id: 'n3', label: 'Isolated' },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      };

      const critique = buildCritique({
        graph: disconnectedGraph,
        identifiable: true,
      });

      const improvement = critique.find(c => c.message.includes('disconnected'));
      expect(improvement).toBeDefined();
      expect(improvement?.severity).toBe('IMPROVEMENT');
    });

    it('returns positive observation for sound graph', () => {
      const critique = buildCritique({
        graph: simpleGraph,
        assumptions: ['Valid assumption'],
        identifiable: true,
      });

      const observation = critique.find(c => c.message.includes('sound'));
      expect(observation).toBeDefined();
      expect(observation?.severity).toBe('OBSERVATION');
    });
  });

  describe('Linearity Check', () => {
    it('flags values outside ±20% range', () => {
      const linearity = checkLinearity({
        baseline_value: 100,
        current_value: 150,
        linear_range_percent: 20,
      });

      expect(linearity.outside_range).toBe(true);
      expect(linearity.distance_from_center).toBe(50);
      expect(linearity.recommendation).toContain('outside linear range');
    });

    it('accepts values within range', () => {
      const linearity = checkLinearity({
        baseline_value: 100,
        current_value: 110,
        linear_range_percent: 20,
      });

      expect(linearity.outside_range).toBe(false);
      expect(linearity.recommendation).toContain('Within linear range');
    });
  });

  describe('Threshold Crossings', () => {
    it('detects upward crossing', () => {
      const crossings = detectThresholdCrossings({
        metric_name: 'price',
        from_value: 95,
        to_value: 105,
        thresholds: [99, 199],
      });

      expect(crossings.length).toBe(1);
      expect(crossings[0].threshold).toBe(99);
      expect(crossings[0].crossed).toBe(true);
      expect(crossings[0].direction).toBe('up');
    });

    it('detects downward crossing', () => {
      const crossings = detectThresholdCrossings({
        metric_name: 'price',
        from_value: 105,
        to_value: 95,
        thresholds: [99, 199],
      });

      expect(crossings.length).toBe(1);
      expect(crossings[0].direction).toBe('down');
    });

    it('returns empty for no crossings', () => {
      const crossings = detectThresholdCrossings({
        metric_name: 'price',
        from_value: 50,
        to_value: 60,
        thresholds: [99, 199],
      });

      expect(crossings.length).toBe(0);
    });
  });

  describe('Explain-Δ', () => {
    it('returns top drivers with contributions', () => {
      const sensitivities = new Map([
        ['n1', 0.5],
        ['n2', -0.3],
        ['n3', 0.7],
      ]);

      const explain = buildExplainDelta({
        graph: simpleGraph,
        baseline_outcome: 100,
        counterfactual_outcome: 120,
        node_sensitivities: sensitivities,
        top_n: 2,
      });

      expect(explain.top_drivers.length).toBeLessThanOrEqual(2);
      expect(explain.summary).toBeDefined();
      
      const top = explain.top_drivers[0];
      expect(top.node_id).toBeDefined();
      expect(top.node_label).toBeDefined();
      expect(top.sign).toMatch(/^[+-]$/);
      expect(top.explanation).toBeDefined();
    });

    it('handles negative delta', () => {
      const explain = buildExplainDelta({
        graph: simpleGraph,
        baseline_outcome: 120,
        counterfactual_outcome: 100,
        top_n: 3,
      });

      expect(explain.summary).toContain('decrease');
    });
  });

  describe('Identifiability', () => {
    it('identifies simple causal path', () => {
      const result = checkIdentifiability({
        graph: simpleGraph,
        treatment_node: 'n1',
        outcome_node: 'n3',
      });

      expect(result.identifiable).toBe(true);
      expect(result.summary).toContain('Identifiable: Yes');
    });

    it('detects missing nodes', () => {
      const result = checkIdentifiability({
        graph: simpleGraph,
        treatment_node: 'nonexistent',
        outcome_node: 'n3',
      });

      expect(result.identifiable).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('suggests adjustment set for confounders', () => {
      const confoundedGraph: Graph = {
        nodes: [
          { id: 'confounder', label: 'Confounder' },
          { id: 'treatment', label: 'Treatment' },
          { id: 'outcome', label: 'Outcome' },
        ],
        edges: [
          { from: 'confounder', to: 'treatment' },
          { from: 'confounder', to: 'outcome' },
          { from: 'treatment', to: 'outcome' },
        ],
      };

      const result = checkIdentifiability({
        graph: confoundedGraph,
        treatment_node: 'treatment',
        outcome_node: 'outcome',
      });

      expect(result.identifiable).toBe(true);
      expect(result.adjustment_set).toBeDefined();
      expect(result.adjustment_set).toContain('confounder');
    });
  });
});
