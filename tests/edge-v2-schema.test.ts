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
  aggregateNoisyAndNot,
  isNodeBinary,
  validateNodeConstraints,
  classifyParent,
  classifyAllParents,
  aggregateMixedCauses,
  aggregateMixedCausesLogistic,
} from '../src/engine/edge-functions.js';
import {
  migrateEdgeToV2,
  migrateEdgesToV2,
  getBeliefExists,
  getBeliefStrength,
  getFunctionalForm,
  sampleWeightWithVariance,
} from '../src/engine/edge-migration.js';
import {
  DEFAULT_WEIGHT_SCHEMA,
  migrateWeightToProbability,
  migrateEdgesToProbabilityWeights,
} from '../src/engine/weight-schema.js';
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
    describe('with leak=0 (backward compatible)', () => {
      it('returns 0 for empty activations', () => {
        expect(aggregateNoisyOr([], 0)).toBe(0);
      });

      it('returns single activation directly', () => {
        expect(aggregateNoisyOr([0.8], 0)).toBeCloseTo(0.8);
      });

      it('combines two activations correctly', () => {
        // P(Y=1) = 1 - (1 - 0.5)(1 - 0.5) = 1 - 0.25 = 0.75
        expect(aggregateNoisyOr([0.5, 0.5], 0)).toBeCloseTo(0.75);
      });

      it('handles three activations', () => {
        // P(Y=1) = 1 - (1 - 0.3)(1 - 0.4)(1 - 0.5) = 1 - 0.7 * 0.6 * 0.5 = 1 - 0.21 = 0.79
        expect(aggregateNoisyOr([0.3, 0.4, 0.5], 0)).toBeCloseTo(0.79);
      });

      it('returns 1 if any activation is 1', () => {
        expect(aggregateNoisyOr([0.3, 1.0, 0.5], 0)).toBe(1);
      });

      it('returns 0 if all activations are 0', () => {
        expect(aggregateNoisyOr([0, 0, 0], 0)).toBe(0);
      });
    });

    describe('with default leak=0.01', () => {
      it('returns leak for empty activations', () => {
        expect(aggregateNoisyOr([])).toBeCloseTo(0.01);
      });

      it('returns leak when all activations are 0', () => {
        // P(Y=1) = 1 - (1-0.01) * 1 * 1 * 1 = 0.01
        expect(aggregateNoisyOr([0, 0, 0])).toBeCloseTo(0.01);
      });

      it('combines activations with leak', () => {
        // P(Y=1) = 1 - (1-0.01) * (1-0.5) = 1 - 0.99 * 0.5 = 1 - 0.495 = 0.505
        expect(aggregateNoisyOr([0.5])).toBeCloseTo(0.505);
      });
    });

    describe('with custom leak values', () => {
      it('leak=0.1 gives 10% background probability', () => {
        // P(Y=1) = 1 - (1-0.1) * 1 = 1 - 0.9 = 0.1
        expect(aggregateNoisyOr([], 0.1)).toBeCloseTo(0.1);
      });

      it('leak=0.1 with all zeros', () => {
        // P(Y=1) = 1 - (1-0.1) * (1-0) * (1-0) = 0.1
        expect(aggregateNoisyOr([0, 0], 0.1)).toBeCloseTo(0.1);
      });

      it('leak=0.5 is a high leak scenario', () => {
        // P(Y=1) = 1 - (1-0.5) * (1-0.3) = 1 - 0.5 * 0.7 = 1 - 0.35 = 0.65
        expect(aggregateNoisyOr([0.3], 0.5)).toBeCloseTo(0.65);
      });

      it('leak=1 always returns 1', () => {
        expect(aggregateNoisyOr([0, 0, 0], 1)).toBe(1);
        expect(aggregateNoisyOr([], 1)).toBe(1);
      });

      it('clamps leak to [0, 1]', () => {
        expect(aggregateNoisyOr([], -0.5)).toBe(0);
        expect(aggregateNoisyOr([], 1.5)).toBe(1);
      });
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

  it('ENABLE_NOISY_AND_NOT flag is read correctly', () => {
    vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
    expect(FLAGS.ENABLE_NOISY_AND_NOT).toBe(true);

    vi.stubEnv('ENABLE_NOISY_AND_NOT', '0');
    expect(FLAGS.ENABLE_NOISY_AND_NOT).toBe(false);

    vi.stubEnv('ENABLE_NOISY_AND_NOT', 'true');
    expect(FLAGS.ENABLE_NOISY_AND_NOT).toBe(true);
  });
});

/**
 * Brief 17: Noisy-OR Leak Parameter Tests
 */
describe('Noisy-OR Leak Parameter (Brief 17)', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_NOISY_OR', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('leak parameter validation', () => {
    it('accepts valid leak values', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
        function_params: { leak: 0.05 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('accepts leak=0 (pure Noisy-OR)', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
        function_params: { leak: 0 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('accepts leak=1 (always fires)', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
        function_params: { leak: 1 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('rejects leak < 0', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
        function_params: { leak: -0.1 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('leak must be in range [0, 1]');
    });

    it('rejects leak > 1', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
        function_params: { leak: 1.5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('leak must be in range [0, 1]');
    });

    it('works without leak parameter (uses default 0.01)', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });
  });
});

/**
 * Brief 17: Noisy-AND-NOT Functional Form Tests
 */
describe('Noisy-AND-NOT Functional Form (Brief 17)', () => {
  describe('applyEdgeFunction with noisy_and_not', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns 1 when parent is 0 (no prevention)', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.8,
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      // When parent=0, factor = 1 - 0.8 * 0 = 1
      expect(applyEdgeFunction(0, edge)).toBe(1);
    });

    it('returns (1-weight) when parent is 1 (full prevention)', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.8,
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      // When parent=1, factor = 1 - 0.8 * 1 = 0.2
      expect(applyEdgeFunction(1, edge)).toBeCloseTo(0.2);
    });

    it('scales proportionally for fractional inputs', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.5,
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.6 },
      };
      // When parent=0.5, factor = 1 - 0.5 * 0.5 = 0.75
      expect(applyEdgeFunction(0.5, edge)).toBeCloseTo(0.75);
    });
  });

  describe('aggregateNoisyAndNot', () => {
    it('returns base_rate for empty factors', () => {
      expect(aggregateNoisyAndNot([], 0.3)).toBeCloseTo(0.3);
    });

    it('returns base_rate when all factors are 1 (no prevention)', () => {
      // P(Y=1) = 0.5 * 1 * 1 * 1 = 0.5
      expect(aggregateNoisyAndNot([1, 1, 1], 0.5)).toBeCloseTo(0.5);
    });

    it('reduces probability with single preventative parent', () => {
      // P(Y=1) = 0.8 * 0.5 = 0.4
      // (one parent with 50% prevention factor)
      expect(aggregateNoisyAndNot([0.5], 0.8)).toBeCloseTo(0.4);
    });

    it('multiplies prevention factors', () => {
      // P(Y=1) = 0.8 * 0.5 * 0.5 = 0.2
      expect(aggregateNoisyAndNot([0.5, 0.5], 0.8)).toBeCloseTo(0.2);
    });

    it('handles three preventative parents', () => {
      // P(Y=1) = 0.9 * 0.7 * 0.6 * 0.5 = 0.189
      expect(aggregateNoisyAndNot([0.7, 0.6, 0.5], 0.9)).toBeCloseTo(0.189);
    });

    it('returns 0 if any factor is 0 (complete prevention)', () => {
      expect(aggregateNoisyAndNot([0.5, 0, 0.8], 0.9)).toBe(0);
    });

    it('returns 0 if base_rate is 0', () => {
      expect(aggregateNoisyAndNot([0.5, 0.5], 0)).toBe(0);
    });

    it('clamps base_rate to [0, 1]', () => {
      expect(aggregateNoisyAndNot([0.5], -0.5)).toBe(0);
      expect(aggregateNoisyAndNot([0.5], 1.5)).toBeCloseTo(0.5);
    });

    it('clamps factors to [0, 1]', () => {
      expect(aggregateNoisyAndNot([1.5], 0.5)).toBeCloseTo(0.5);
      expect(aggregateNoisyAndNot([-0.5], 0.5)).toBe(0);
    });
  });

  describe('noisy_and_not validation', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns error when flag is disabled', () => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '0');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('noisy_and_not is disabled');
    });

    it('requires base_rate parameter', () => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_and_not',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('base_rate parameter');
    });

    it('rejects base_rate < 0', () => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_and_not',
        function_params: { base_rate: -0.1 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('base_rate must be in range [0, 1]');
    });

    it('rejects base_rate > 1', () => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 1.5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('base_rate must be in range [0, 1]');
    });

    it('accepts valid base_rate', () => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });
  });

  describe('binary node constraints for noisy_and_not', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('validates binary source nodes', () => {
      const edges: GraphEdge[] = [
        {
          from: 'ContinuousNode',
          to: 'BinaryTarget',
          functional_form: 'noisy_and_not',
          function_params: { base_rate: 0.5 },
        },
      ];
      const nodeMap = new Map([
        ['ContinuousNode', { value: 0.5 }], // Not binary
        ['BinaryTarget', { kind: 'option' }], // Binary
      ]);

      const errors = validateNodeConstraints(edges, nodeMap);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('noisy_and_not requires binary source node');
    });

    it('validates binary target nodes', () => {
      const edges: GraphEdge[] = [
        {
          from: 'BinarySource',
          to: 'ContinuousTarget',
          functional_form: 'noisy_and_not',
          function_params: { base_rate: 0.5 },
        },
      ];
      const nodeMap = new Map([
        ['BinarySource', { value: 1 }], // Binary
        ['ContinuousTarget', { value: 0.7 }], // Not binary
      ]);

      const errors = validateNodeConstraints(edges, nodeMap);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('noisy_and_not requires binary target node');
    });

    it('passes validation for binary nodes', () => {
      const edges: GraphEdge[] = [
        {
          from: 'SafetyTraining',
          to: 'Accident',
          functional_form: 'noisy_and_not',
          function_params: { base_rate: 0.3 },
        },
      ];
      const nodeMap = new Map([
        ['SafetyTraining', { kind: 'option', value: 1 }],
        ['Accident', { kind: 'outcome', value: 0 }],
      ]);

      const errors = validateNodeConstraints(edges, nodeMap);
      expect(errors.length).toBe(0);
    });
  });

  describe('real-world preventative cause scenarios', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('models safety training reducing accident probability', () => {
      // Scenario: Base accident rate is 30%, safety training reduces it by 50%
      // P(accident | safety_training=1) = 0.3 * (1 - 0.5 * 1) = 0.3 * 0.5 = 0.15
      const factors = [0.5]; // Factor from training with weight=0.5
      expect(aggregateNoisyAndNot(factors, 0.3)).toBeCloseTo(0.15);
    });

    it('models competitor entry reducing market share', () => {
      // Scenario: Base market share 80%, two competitors each reduce by 70%
      // P(high_share | competitor1=1, competitor2=1) = 0.8 * 0.3 * 0.3 = 0.072
      const factors = [0.3, 0.3]; // Each competitor has weight=0.7, so factor=0.3
      expect(aggregateNoisyAndNot(factors, 0.8)).toBeCloseTo(0.072);
    });

    it('models hedging reducing downside risk', () => {
      // Scenario: Base risk 40%, hedging reduces by 90%
      // P(loss | hedging=1) = 0.4 * (1 - 0.9 * 1) = 0.4 * 0.1 = 0.04
      const factors = [0.1]; // Factor from hedge with weight=0.9
      expect(aggregateNoisyAndNot(factors, 0.4)).toBeCloseTo(0.04);
    });
  });
});

/**
 * Brief 21: Weight Range Normalisation Tests
 *
 * Powers > 1 break probability semantics in Noisy-OR/AND-NOT because
 * 1 - w*x can become negative when w > 1 and x = 1.
 */
describe('Weight Range Normalisation (Brief 21)', () => {
  describe('default weight schema', () => {
    it('default weight schema is v1 ([-1, +1])', () => {
      expect(DEFAULT_WEIGHT_SCHEMA).toBe('v1');
    });
  });

  describe('noisy_or weight validation', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_NOISY_OR', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('accepts weight in [0, 1]', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.8,
        functional_form: 'noisy_or',
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('accepts weight = 0', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0,
        functional_form: 'noisy_or',
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('accepts weight = 1', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 1,
        functional_form: 'noisy_or',
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('rejects negative weight', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: -0.5,
        functional_form: 'noisy_or',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.field).toBe('weight');
      expect(error?.message).toContain('noisy_or requires weight in [0, 1]');
      expect(error?.message).toContain('migrateWeightToProbability()');
    });

    it('rejects weight > 1', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 2.5,
        functional_form: 'noisy_or',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('noisy_or requires weight in [0, 1]');
    });

    it('allows undefined weight (defaults to 1)', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'noisy_or',
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });
  });

  describe('noisy_and_not weight validation', () => {
    beforeEach(() => {
      vi.stubEnv('ENABLE_NOISY_AND_NOT', '1');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('accepts weight in [0, 1]', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 0.7,
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('rejects negative weight', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: -0.3,
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.field).toBe('weight');
      expect(error?.message).toContain('noisy_and_not requires weight in [0, 1]');
    });

    it('rejects weight > 1', () => {
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        weight: 1.5,
        functional_form: 'noisy_and_not',
        function_params: { base_rate: 0.5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('noisy_and_not requires weight in [0, 1]');
    });
  });

  describe('migrateWeightToProbability', () => {
    it('keeps weights in [0, 1] unchanged', () => {
      const result = migrateWeightToProbability(0.5);
      expect(result.weight).toBe(0.5);
      expect(result.modified).toBe(false);
      expect(result.clamped).toBe(false);
    });

    it('converts negative weight to absolute value', () => {
      const result = migrateWeightToProbability(-0.7);
      expect(result.weight).toBe(0.7);
      expect(result.modified).toBe(true);
      expect(result.clamped).toBe(false);
    });

    it('scales v2 weight (1, 3] proportionally', () => {
      // weight = 1.5 should become 1.5/3 = 0.5
      const result = migrateWeightToProbability(1.5);
      expect(result.weight).toBeCloseTo(0.5);
      expect(result.modified).toBe(true);
      expect(result.clamped).toBe(false);
    });

    it('scales weight = 3 to probability 1', () => {
      const result = migrateWeightToProbability(3);
      expect(result.weight).toBeCloseTo(1);
      expect(result.modified).toBe(true);
    });

    it('clamps weight > 3 with warning', () => {
      const result = migrateWeightToProbability(5);
      expect(result.weight).toBe(1);
      expect(result.modified).toBe(true);
      expect(result.clamped).toBe(true);
      expect(result.warning).toContain('exceeds maximum');
    });

    it('handles boundary cases', () => {
      expect(migrateWeightToProbability(0).weight).toBe(0);
      expect(migrateWeightToProbability(1).weight).toBe(1);
      expect(migrateWeightToProbability(1.001).weight).toBeCloseTo(0.3337, 3);
    });
  });

  describe('migrateEdgesToProbabilityWeights', () => {
    it('migrates noisy_or edges with out-of-range weights', () => {
      const edges = [
        { from: 'A', to: 'B', weight: 2.0, functional_form: 'noisy_or' },
        { from: 'B', to: 'C', weight: 0.5, functional_form: 'noisy_or' },
      ];

      const result = migrateEdgesToProbabilityWeights(edges);

      expect(result.migrated_count).toBe(1);
      expect(result.edges[0].weight).toBeCloseTo(0.667, 2); // 2/3
      expect(result.edges[1].weight).toBe(0.5); // unchanged
    });

    it('migrates noisy_and_not edges with out-of-range weights', () => {
      const edges = [
        { from: 'A', to: 'B', weight: 1.5, functional_form: 'noisy_and_not', function_params: { base_rate: 0.5 } },
      ];

      const result = migrateEdgesToProbabilityWeights(edges);

      expect(result.migrated_count).toBe(1);
      expect(result.edges[0].weight).toBeCloseTo(0.5, 2); // 1.5/3
    });

    it('does not migrate linear edges', () => {
      const edges = [
        { from: 'A', to: 'B', weight: 2.0, functional_form: 'linear' },
        { from: 'B', to: 'C', weight: 3.0 }, // no function_type = linear
      ];

      const result = migrateEdgesToProbabilityWeights(edges);

      expect(result.migrated_count).toBe(0);
      expect(result.edges[0].weight).toBe(2.0);
      expect(result.edges[1].weight).toBe(3.0);
    });

    it('reports clamped weights in warnings', () => {
      const edges = [
        { from: 'A', to: 'B', weight: 5.0, functional_form: 'noisy_or' },
      ];

      const result = migrateEdgesToProbabilityWeights(edges);

      expect(result.clamped_count).toBe(1);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('A->B');
    });

    it('handles mixed edge types', () => {
      const edges = [
        { from: 'A', to: 'B', weight: 2.0, functional_form: 'noisy_or' },
        { from: 'B', to: 'C', weight: 2.0, functional_form: 'linear' },
        { from: 'C', to: 'D', weight: 2.0, functional_form: 'noisy_and_not', function_params: { base_rate: 0.5 } },
        { from: 'D', to: 'E', weight: 0.5, functional_form: 'noisy_or' }, // already in range
      ];

      const result = migrateEdgesToProbabilityWeights(edges);

      expect(result.migrated_count).toBe(2); // A->B and C->D
      expect(result.edges[0].weight).toBeCloseTo(0.667, 2);
      expect(result.edges[1].weight).toBe(2.0); // linear unchanged
      expect(result.edges[2].weight).toBeCloseTo(0.667, 2);
      expect(result.edges[3].weight).toBe(0.5); // already in range
    });
  });
});

/**
 * Brief 22: Mixed Cause Combination Tests
 *
 * Tests for nodes with both generative (positive weight) and preventative (negative weight) parents.
 */
describe('Mixed Cause Combination (Brief 22)', () => {
  describe('classifyParent', () => {
    it('classifies positive weight as generative', () => {
      expect(classifyParent(0.5)).toBe('generative');
      expect(classifyParent(0.01)).toBe('generative');
      expect(classifyParent(1.0)).toBe('generative');
    });

    it('classifies negative weight as preventative', () => {
      expect(classifyParent(-0.5)).toBe('preventative');
      expect(classifyParent(-0.01)).toBe('preventative');
      expect(classifyParent(-1.0)).toBe('preventative');
    });

    it('classifies zero weight as neutral', () => {
      expect(classifyParent(0)).toBe('neutral');
    });
  });

  describe('classifyAllParents', () => {
    it('groups parents by weight sign', () => {
      const parents = [
        { parentId: 'A', weight: 0.8, value: 1 },
        { parentId: 'B', weight: -0.6, value: 1 },
        { parentId: 'C', weight: 0.3, value: 0.5 },
        { parentId: 'D', weight: 0, value: 1 },
        { parentId: 'E', weight: -0.4, value: 0 },
      ];

      const result = classifyAllParents(parents);

      expect(result.generative).toHaveLength(2);
      expect(result.preventative).toHaveLength(2);
      expect(result.neutral).toHaveLength(1);
      expect(result.generative.map((p) => p.parentId)).toEqual(['A', 'C']);
      expect(result.preventative.map((p) => p.parentId)).toEqual(['B', 'E']);
      expect(result.neutral.map((p) => p.parentId)).toEqual(['D']);
    });

    it('handles empty parents', () => {
      const result = classifyAllParents([]);
      expect(result.generative).toHaveLength(0);
      expect(result.preventative).toHaveLength(0);
      expect(result.neutral).toHaveLength(0);
    });
  });

  describe('aggregateMixedCauses (nested mode)', () => {
    it('returns leak when no parents are active', () => {
      const classified = {
        generative: [],
        preventative: [],
        neutral: [],
      };
      // With no parents, only leak contributes
      expect(aggregateMixedCauses(classified, { leak: 0.01 })).toBeCloseTo(0.01);
    });

    it('behaves like Noisy-OR with only generative parents', () => {
      const classified = {
        generative: [
          { parentId: 'A', weight: 0.8, value: 1 },
          { parentId: 'B', weight: 0.5, value: 1 },
        ],
        preventative: [],
        neutral: [],
      };
      // P = 1 - (1-0.01) * (1-0.8) * (1-0.5) = 1 - 0.99 * 0.2 * 0.5 = 1 - 0.099 = 0.901
      expect(aggregateMixedCauses(classified, { leak: 0.01 })).toBeCloseTo(0.901);
    });

    it('behaves like Noisy-AND-NOT with only preventative parents', () => {
      const classified = {
        generative: [],
        preventative: [
          { parentId: 'A', weight: -0.5, value: 1 }, // |weight| = 0.5
          { parentId: 'B', weight: -0.3, value: 1 }, // |weight| = 0.3
        ],
        neutral: [],
      };
      // base_rate=0.8, leak=0.01
      // preventative factor = (1-0.5) * (1-0.3) = 0.5 * 0.7 = 0.35
      // generative P = 0.01 (leak only, no generative parents)
      // Combined: 0.8 * 0.35 * 0.01 = 0.0028
      expect(aggregateMixedCauses(classified, { base_rate: 0.8, leak: 0.01 })).toBeCloseTo(0.0028);
    });

    it('combines generative and preventative parents', () => {
      const classified = {
        generative: [
          { parentId: 'A', weight: 0.8, value: 1 }, // High causal power
        ],
        preventative: [
          { parentId: 'B', weight: -0.5, value: 1 }, // 50% prevention
        ],
        neutral: [],
      };
      // generative P = 1 - (1-0.01) * (1-0.8) = 1 - 0.99 * 0.2 = 0.802
      // preventative factor = (1-0.5) = 0.5
      // Combined: 1.0 * 0.5 * 0.802 = 0.401
      expect(aggregateMixedCauses(classified, { base_rate: 1.0, leak: 0.01 })).toBeCloseTo(0.401);
    });

    it('handles inactive parents correctly', () => {
      const classified = {
        generative: [
          { parentId: 'A', weight: 0.8, value: 0 }, // Inactive
        ],
        preventative: [
          { parentId: 'B', weight: -0.5, value: 0 }, // Inactive
        ],
        neutral: [],
      };
      // With all parents inactive, only leak contributes
      // generative P = 0.01 (leak only since activation = 0.8 * 0 = 0)
      // preventative factor = 1 (no prevention since value = 0)
      // Combined: 1.0 * 1 * 0.01 = 0.01
      expect(aggregateMixedCauses(classified, { base_rate: 1.0, leak: 0.01 })).toBeCloseTo(0.01);
    });
  });

  describe('aggregateMixedCausesLogistic', () => {
    it('returns 0.5 when generative and preventative balance out', () => {
      const classified = {
        generative: [
          { parentId: 'A', weight: 0.5, value: 1 },
        ],
        preventative: [
          { parentId: 'B', weight: -0.5, value: 1 },
        ],
        neutral: [],
      };
      // sum_gen = 0.5, sum_prev = 0.5
      // With bias = 0 (base_rate=0.5), linear sum = 0.5 - 0.5 + 0 = 0
      // P = 1 / (1 + exp(0)) = 0.5
      expect(aggregateMixedCausesLogistic(classified, { base_rate: 0.5 })).toBeCloseTo(0.5, 1);
    });

    it('returns high probability with generative dominance', () => {
      const classified = {
        generative: [
          { parentId: 'A', weight: 0.8, value: 1 },
        ],
        preventative: [],
        neutral: [],
      };
      // sum_gen = 0.8, sum_prev = 0
      // P > 0.5
      const result = aggregateMixedCausesLogistic(classified, { base_rate: 0.5, logistic_k: 4 });
      expect(result).toBeGreaterThan(0.5);
      expect(result).toBeGreaterThan(0.8); // Should be close to 1
    });

    it('returns low probability with preventative dominance', () => {
      const classified = {
        generative: [],
        preventative: [
          { parentId: 'A', weight: -0.8, value: 1 },
        ],
        neutral: [],
      };
      // sum_gen = 0, sum_prev = 0.8
      // P < 0.5
      const result = aggregateMixedCausesLogistic(classified, { base_rate: 0.5, logistic_k: 4 });
      expect(result).toBeLessThan(0.5);
      expect(result).toBeLessThan(0.2); // Should be close to 0
    });

    it('respects base_rate bias', () => {
      const classified = {
        generative: [],
        preventative: [],
        neutral: [],
      };
      // With no parents, P = base_rate
      expect(aggregateMixedCausesLogistic(classified, { base_rate: 0.8 })).toBeCloseTo(0.8, 1);
      expect(aggregateMixedCausesLogistic(classified, { base_rate: 0.2 })).toBeCloseTo(0.2, 1);
    });
  });

  describe('mixed functional form validation', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns error when flag is disabled', () => {
      vi.stubEnv('ENABLE_MIXED_COMBINATION', '0');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'mixed',
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('mixed is disabled');
    });

    it('accepts valid mixed configuration', () => {
      vi.stubEnv('ENABLE_MIXED_COMBINATION', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'mixed',
        function_params: {
          base_rate: 0.5,
          leak: 0.01,
          combination_mode: 'nested',
        },
      };
      expect(validateEdgeFunctionParams(edge)).toBeNull();
    });

    it('rejects invalid base_rate', () => {
      vi.stubEnv('ENABLE_MIXED_COMBINATION', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'mixed',
        function_params: { base_rate: 1.5 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('base_rate must be in range [0, 1]');
    });

    it('rejects invalid leak', () => {
      vi.stubEnv('ENABLE_MIXED_COMBINATION', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'mixed',
        function_params: { leak: -0.1 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('leak must be in range [0, 1]');
    });

    it('rejects invalid logistic_k', () => {
      vi.stubEnv('ENABLE_MIXED_COMBINATION', '1');
      const edge: GraphEdge = {
        from: 'A',
        to: 'B',
        functional_form: 'mixed',
        function_params: { logistic_k: 0 },
      };
      const error = validateEdgeFunctionParams(edge);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('logistic_k must be > 0');
    });
  });

  describe('ENABLE_MIXED_COMBINATION flag', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('flag is read correctly', () => {
      vi.stubEnv('ENABLE_MIXED_COMBINATION', '1');
      expect(FLAGS.ENABLE_MIXED_COMBINATION).toBe(true);

      vi.stubEnv('ENABLE_MIXED_COMBINATION', '0');
      expect(FLAGS.ENABLE_MIXED_COMBINATION).toBe(false);

      vi.stubEnv('ENABLE_MIXED_COMBINATION', 'true');
      expect(FLAGS.ENABLE_MIXED_COMBINATION).toBe(true);
    });
  });

  describe('real-world mixed cause scenarios', () => {
    it('models marketing vs competitor pressure', () => {
      // Marketing increases sales (generative), competitor actions reduce sales (preventative)
      const classified = {
        generative: [
          { parentId: 'marketing', weight: 0.6, value: 1 },
          { parentId: 'product_quality', weight: 0.5, value: 1 },
        ],
        preventative: [
          { parentId: 'competitor_price_cut', weight: -0.4, value: 1 },
          { parentId: 'economic_downturn', weight: -0.3, value: 0.5 },
        ],
        neutral: [],
      };

      const result = aggregateMixedCauses(classified, { base_rate: 0.8, leak: 0.01 });
      // Generative: 1 - 0.99 * 0.4 * 0.5 = 0.802
      // Preventative: (1-0.4) * (1-0.3*0.5) = 0.6 * 0.85 = 0.51
      // Combined: 0.8 * 0.51 * 0.802 ≈ 0.327
      expect(result).toBeGreaterThan(0.2);
      expect(result).toBeLessThan(0.5);
    });

    it('models drug effectiveness vs side effects', () => {
      // Drug treats disease (generative), side effects reduce effectiveness (preventative)
      const classified = {
        generative: [
          { parentId: 'drug_dose', weight: 0.9, value: 1 },
        ],
        preventative: [
          { parentId: 'side_effect_severity', weight: -0.3, value: 0.8 },
        ],
        neutral: [],
      };

      const result = aggregateMixedCauses(classified, { base_rate: 1.0, leak: 0.01 });
      expect(result).toBeGreaterThan(0.5);
      expect(result).toBeLessThan(0.9);
    });
  });
});
