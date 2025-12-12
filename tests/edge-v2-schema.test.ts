/**
 * EdgeV2 Schema & Functional Forms Tests
 *
 * Tests for Brief 5: Dual beliefs, Noisy-OR, Logistic, and migration
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runKernel } from '../src/scm-lite/kernel.js';
import type { DAG, Edge } from '../src/scm-lite/types.js';
import {
  applyEdgeFunction,
  validateEdgeFunctionParams,
  aggregateNoisyOr,
  isNodeBinary,
  validateNodeConstraints,
} from '../src/engine/edge-functions.js';
import {
  migrateEdgeToV2,
  migrateEdgesToV2,
  getBeliefExists,
  getBeliefStrength,
  getFunctionalForm,
  sampleWeightWithVariance,
} from '../src/engine/edge-migration.js';
import { FLAGS } from '../src/config/flags.js';
import type { GraphEdge } from '../src/trust/types.js';

describe('EdgeV2 Schema', () => {
  describe('Dual Beliefs Migration', () => {
    it('migrates EdgeV1 with single belief to EdgeV2', () => {
      const edgeV1: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.8,
        belief: 0.6,
      };

      const edgeV2 = migrateEdgeToV2(edgeV1);

      expect(edgeV2.source).toBe('A');
      expect(edgeV2.target).toBe('B');
      expect(edgeV2.weight).toBe(0.8);
      expect(edgeV2.belief_exists).toBe(0.6);
      expect(edgeV2.belief_strength).toBe(0.6); // Legacy belief used as strength proxy
      expect(edgeV2.functional_form).toBe('linear');
      expect(edgeV2.provenance).toBe('template'); // Default provenance
    });

    it('migrates EdgeV1 with defaults when belief not specified', () => {
      const edgeV1: GraphEdge = {
        from: 'A',
        to: 'B',
      };

      const edgeV2 = migrateEdgeToV2(edgeV1);

      expect(edgeV2.belief_exists).toBe(1.0);
      expect(edgeV2.belief_strength).toBe(0.8);
      expect(edgeV2.weight).toBe(1.0);
    });

    it('preserves EdgeV2 fields during migration', () => {
      const edgeV2Style: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.5,
        belief_exists: 0.9,
        belief_strength: 0.7,
        functional_form: 'threshold',
        function_params: { threshold: 0.5 },
      };

      const migrated = migrateEdgeToV2(edgeV2Style);

      expect(migrated.belief_exists).toBe(0.9);
      expect(migrated.belief_strength).toBe(0.7);
      expect(migrated.functional_form).toBe('threshold');
      expect(migrated.function_params).toEqual({ threshold: 0.5 });
    });

    it('batch migrates multiple edges', () => {
      const edges: GraphEdge[] = [
        { from: 'A', to: 'B', belief: 0.5 },
        { from: 'B', to: 'C', belief: 0.8 },
        { from: 'C', to: 'D', weight: 2.0 },
      ];

      const migrated = migrateEdgesToV2(edges);

      expect(migrated).toHaveLength(3);
      expect(migrated[0].belief_exists).toBe(0.5);
      expect(migrated[1].belief_exists).toBe(0.8);
      expect(migrated[2].belief_exists).toBe(1.0);
    });
  });

  describe('Belief Accessor Functions', () => {
    it('getBeliefExists returns belief_exists when present', () => {
      const edge: GraphEdge = { from: 'A', to: 'B', belief_exists: 0.75 };
      expect(getBeliefExists(edge)).toBe(0.75);
    });

    it('getBeliefExists falls back to legacy belief', () => {
      const edge: GraphEdge = { from: 'A', to: 'B', belief: 0.6 };
      expect(getBeliefExists(edge)).toBe(0.6);
    });

    it('getBeliefExists returns default (1.0) when neither specified', () => {
      const edge: GraphEdge = { from: 'A', to: 'B' };
      // Default is 1.0 (EDGE_V2_DEFAULTS.BELIEF_EXISTS) when no belief specified
      expect(getBeliefExists(edge)).toBe(1.0);
    });

    it('getBeliefStrength returns belief_strength when present', () => {
      const edge: GraphEdge = { from: 'A', to: 'B', belief_strength: 0.9 };
      expect(getBeliefStrength(edge)).toBe(0.9);
    });

    it('getBeliefStrength falls back to legacy belief', () => {
      const edge: GraphEdge = { from: 'A', to: 'B', belief: 0.5 };
      expect(getBeliefStrength(edge)).toBe(0.5);
    });

    it('getFunctionalForm returns functional_form when present', () => {
      const edge: GraphEdge = { from: 'A', to: 'B', functional_form: 's_curve' };
      expect(getFunctionalForm(edge)).toBe('s_curve');
    });

    it('getFunctionalForm falls back to function_type', () => {
      const edge: GraphEdge = { from: 'A', to: 'B', function_type: 'threshold' };
      expect(getFunctionalForm(edge)).toBe('threshold');
    });

    it('getFunctionalForm defaults to linear', () => {
      const edge: GraphEdge = { from: 'A', to: 'B' };
      expect(getFunctionalForm(edge)).toBe('linear');
    });
  });

  describe('Weight Sampling with Variance', () => {
    it('returns base weight when belief_strength is 1.0', () => {
      const weight = sampleWeightWithVariance(0.8, 1.0, 0.5);
      expect(weight).toBe(0.8);
    });

    it('returns base weight when variance is 0', () => {
      const weight = sampleWeightWithVariance(1.5, 1.0, 0.3);
      expect(weight).toBe(1.5);
    });

    it('varies weight when belief_strength is low', () => {
      // With belief_strength = 0, random = 0.5 (middle), adjustment should be ~0
      const weight1 = sampleWeightWithVariance(1.0, 0.0, 0.5);
      expect(weight1).toBeCloseTo(1.0, 1);

      // With belief_strength = 0, random = 0 (low), weight should decrease
      const weight2 = sampleWeightWithVariance(1.0, 0.0, 0.0);
      expect(weight2).toBeLessThan(1.0);

      // With belief_strength = 0, random = 1 (high), weight should increase
      const weight3 = sampleWeightWithVariance(1.0, 0.0, 1.0);
      expect(weight3).toBeGreaterThan(1.0);
    });

    it('has smaller variance with higher belief_strength', () => {
      // Low belief_strength = more variance
      const lowStrength1 = sampleWeightWithVariance(1.0, 0.2, 0.0);
      const lowStrength2 = sampleWeightWithVariance(1.0, 0.2, 1.0);
      const lowVariance = Math.abs(lowStrength2 - lowStrength1);

      // High belief_strength = less variance
      const highStrength1 = sampleWeightWithVariance(1.0, 0.9, 0.0);
      const highStrength2 = sampleWeightWithVariance(1.0, 0.9, 1.0);
      const highVariance = Math.abs(highStrength2 - highStrength1);

      expect(highVariance).toBeLessThan(lowVariance);
    });
  });
});

describe('Noisy-OR Functional Form', () => {
  describe('applyEdgeFunction with noisy_or', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_NOISY_OR', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns 0 for binary parent state 0', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.8,
        functional_form: 'noisy_or',
      };
      expect(applyEdgeFunction(0, edge)).toBe(0);
    });

    it('returns causal power for binary parent state 1', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.8,
        functional_form: 'noisy_or',
      };
      expect(applyEdgeFunction(1, edge)).toBe(0.8);
    });

    it('scales linearly with continuous input', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.6,
        functional_form: 'noisy_or',
      };
      expect(applyEdgeFunction(0.5, edge)).toBe(0.3);
    });

    it('clamps input to [0, 1]', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.5,
        functional_form: 'noisy_or',
      };
      expect(applyEdgeFunction(-0.5, edge)).toBe(0);
      expect(applyEdgeFunction(1.5, edge)).toBe(0.5);
    });

    it('clamps weight to [0, 1]', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 1.5,
        functional_form: 'noisy_or',
      };
      expect(applyEdgeFunction(1, edge)).toBe(1);
    });
  });

  describe('aggregateNoisyOr', () => {
    it('returns 0 for empty activations', () => {
      expect(aggregateNoisyOr([])).toBe(0);
    });

    it('returns single activation directly', () => {
      expect(aggregateNoisyOr([0.8])).toBeCloseTo(0.8);
    });

    it('combines two activations correctly', () => {
      // P(Y=1) = 1 - (1 - 0.5)(1 - 0.5) = 1 - 0.25 = 0.75
      expect(aggregateNoisyOr([0.5, 0.5])).toBeCloseTo(0.75);
    });

    it('handles three activations', () => {
      // P(Y=1) = 1 - (1 - 0.3)(1 - 0.4)(1 - 0.5) = 1 - 0.7 * 0.6 * 0.5 = 1 - 0.21 = 0.79
      expect(aggregateNoisyOr([0.3, 0.4, 0.5])).toBeCloseTo(0.79);
    });

    it('returns 1 if any activation is 1', () => {
      expect(aggregateNoisyOr([0.3, 1.0, 0.5])).toBe(1);
    });

    it('returns 0 if all activations are 0', () => {
      expect(aggregateNoisyOr([0, 0, 0])).toBe(0);
    });
  });

  describe('noisy_or validation', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns error when flag is disabled', () => {
      vi.stubEnv('ENABLE_NOISY_OR', '0');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('noisy_or is disabled');
    });

    it('returns null when flag is enabled', () => {
      vi.stubEnv('ENABLE_NOISY_OR', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).toBeNull();
    });
  });

  describe('binary node validation', () => {
    it('identifies option nodes as binary', () => {
      expect(isNodeBinary({ kind: 'option' })).toBe(true);
    });

    it('identifies decision nodes as binary', () => {
      expect(isNodeBinary({ kind: 'decision' })).toBe(true);
    });

    it('identifies value 0 or 1 as binary', () => {
      expect(isNodeBinary({ value: 0 })).toBe(true);
      expect(isNodeBinary({ value: 1 })).toBe(true);
    });

    it('identifies continuous values as non-binary', () => {
      expect(isNodeBinary({ value: 0.5 })).toBe(false);
      expect(isNodeBinary({ value: 2 })).toBe(false);
    });

    it('defaults to non-binary', () => {
      expect(isNodeBinary({})).toBe(false);
    });
  });
});

describe('Logistic Functional Form', () => {
  describe('applyEdgeFunction with logistic', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_LOGISTIC', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns 0.5 at threshold', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 1, threshold: 5 },
      };
      expect(applyEdgeFunction(5, edge)).toBeCloseTo(0.5);
    });

    it('returns ~0 well below threshold', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 2, threshold: 10 },
      };
      expect(applyEdgeFunction(0, edge)).toBeLessThan(0.01);
    });

    it('returns ~1 well above threshold', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 2, threshold: 0 },
      };
      expect(applyEdgeFunction(10, edge)).toBeGreaterThan(0.99);
    });

    it('steeper k gives sharper transition', () => {
      const shallowEdge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 0.5, threshold: 5 },
      };
      const steepEdge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 5, threshold: 5 },
      };

      // At x=6, steep k should be closer to 1
      const shallowAt6 = applyEdgeFunction(6, shallowEdge);
      const steepAt6 = applyEdgeFunction(6, steepEdge);
      expect(steepAt6).toBeGreaterThan(shallowAt6);
    });
  });

  describe('logistic validation', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns error when flag is disabled', () => {
      vi.stubEnv('ENABLE_LOGISTIC', '0');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 1, threshold: 0 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('logistic is disabled');
    });

    it('returns error when k is missing', () => {
      vi.stubEnv('ENABLE_LOGISTIC', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { threshold: 0 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('requires k parameter');
    });

    it('returns error when k is not positive', () => {
      vi.stubEnv('ENABLE_LOGISTIC', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 0, threshold: 0 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('k must be > 0');
    });

    it('returns error when threshold is missing', () => {
      vi.stubEnv('ENABLE_LOGISTIC', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 1 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('requires threshold parameter');
    });

    it('returns null when all params valid', () => {
      vi.stubEnv('ENABLE_LOGISTIC', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'logistic',
        function_params: { k: 2, threshold: 5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).toBeNull();
    });
  });
});

describe('Kernel Integration with EdgeV2', () => {
  const simpleDAG: DAG = {
    nodes: [
      { id: 'A' },
      { id: 'B' },
      { id: 'C' },
    ],
    edges: [
      { from: 'A', to: 'B', weight: 0.8, belief: 0.9 },
      { from: 'B', to: 'C', weight: 0.5, belief: 0.7 },
    ],
  };

  it('kernel runs with EdgeV1 edges (backward compatibility)', () => {
    const result = runKernel(simpleDAG, 'C', { seed: 42, K: 16 });

    expect(result.target).toBe('C');
    expect(result.quantiles).toBeDefined();
    expect(result.quantiles.p50).toBeGreaterThan(0);
    expect(result.confidence).toBeDefined();
  });

  it('kernel runs with EdgeV2 dual beliefs', () => {
    const dagV2: DAG = {
      nodes: [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' },
      ],
      edges: [
        { from: 'A', to: 'B', weight: 0.8, belief_exists: 0.9, belief_strength: 0.8 },
        { from: 'B', to: 'C', weight: 0.5, belief_exists: 0.7, belief_strength: 0.6 },
      ],
    };

    const result = runKernel(dagV2, 'C', { seed: 42, K: 16 });

    expect(result.target).toBe('C');
    expect(result.quantiles).toBeDefined();
    expect(result.confidence).toBeDefined();
  });

  it('produces deterministic results with same seed', () => {
    const result1 = runKernel(simpleDAG, 'C', { seed: 123, K: 32 });
    const result2 = runKernel(simpleDAG, 'C', { seed: 123, K: 32 });

    expect(result1.quantiles.p50).toBe(result2.quantiles.p50);
    expect(result1.bma_hash).toBe(result2.bma_hash);
  });

  it('belief_exists affects edge activation probability', () => {
    // DAG with multiple edges and varying belief_exists
    // A -> B -> C with high beliefs
    const highBeliefDAG: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'A', to: 'B', weight: 2.0, belief_exists: 1.0 },
        { from: 'B', to: 'C', weight: 2.0, belief_exists: 1.0 },
      ],
    };

    // Same structure with uncertain beliefs - may or may not include edges
    const uncertainBeliefDAG: DAG = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'A', to: 'B', weight: 2.0, belief_exists: 0.5 },
        { from: 'B', to: 'C', weight: 2.0, belief_exists: 0.5 },
      ],
    };

    const highResult = runKernel(highBeliefDAG, 'C', { seed: 42, K: 64 });
    const uncertainResult = runKernel(uncertainBeliefDAG, 'C', { seed: 42, K: 64 });

    // With belief_exists = 1.0, only one graph topology
    expect(highResult.meta.unique_graphs).toBe(1);

    // With belief_exists = 0.5, multiple graph topologies are possible
    expect(uncertainResult.meta.unique_graphs).toBeGreaterThan(1);
  });
});

describe('Feature Flag Gating', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ENABLE_DUAL_BELIEFS flag is read correctly', () => {
    vi.stubEnv('ENABLE_DUAL_BELIEFS', '1');
    expect(FLAGS.ENABLE_DUAL_BELIEFS).toBe(true);

    vi.stubEnv('ENABLE_DUAL_BELIEFS', '0');
    expect(FLAGS.ENABLE_DUAL_BELIEFS).toBe(false);

    vi.stubEnv('ENABLE_DUAL_BELIEFS', 'true');
    expect(FLAGS.ENABLE_DUAL_BELIEFS).toBe(true);
  });

  it('ENABLE_NOISY_OR flag is read correctly', () => {
    vi.stubEnv('ENABLE_NOISY_OR', '1');
    expect(FLAGS.ENABLE_NOISY_OR).toBe(true);

    vi.stubEnv('ENABLE_NOISY_OR', '0');
    expect(FLAGS.ENABLE_NOISY_OR).toBe(false);
  });

  it('ENABLE_LOGISTIC flag is read correctly', () => {
    vi.stubEnv('ENABLE_LOGISTIC', '1');
    expect(FLAGS.ENABLE_LOGISTIC).toBe(true);

    vi.stubEnv('ENABLE_LOGISTIC', '0');
    expect(FLAGS.ENABLE_LOGISTIC).toBe(false);
  });
});
