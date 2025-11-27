import { describe, it, expect } from 'vitest';
import { modelOfInferenceEngine, type MetaReasoningResult } from '../src/inference/model_of_inference.js';
import type { Graph } from '../src/trust/types.js';
import type { InferenceConfig } from '../src/inference/types.js';

describe('Model-of-Inference Engine', () => {
  const createTestGraph = (nodeCount: number): Graph => ({
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `node_${i}`,
      label: `Node ${i}`,
    })),
    edges: Array.from({ length: nodeCount - 1 }, (_, i) => ({
      from: `node_${i}`,
      to: `node_${i + 1}`,
    })),
  });

  const defaultConfig: InferenceConfig = {
    seed: 42,
    k_samples: 256,
    outcome_node: 'node_2',
    baseline_value: 100,
  };

  it('returns base inference results', () => {
    const graph = createTestGraph(3);
    const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

    expect(result.conservative).toBeDefined();
    expect(result.most_likely).toBeDefined();
    expect(result.optimistic).toBeDefined();
    expect(typeof result.conservative.outcome).toBe('number');
    expect(typeof result.most_likely.outcome).toBe('number');
    expect(typeof result.optimistic.outcome).toBe('number');
  });

  it('includes meta_reasoning quality assessment', () => {
    const graph = createTestGraph(3);
    const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

    expect(result.meta_reasoning).toBeDefined();
    expect(result.meta_reasoning.quality_assessment).toBeDefined();
    expect(result.meta_reasoning.quality_assessment.overall_score).toBeGreaterThanOrEqual(0);
    expect(result.meta_reasoning.quality_assessment.overall_score).toBeLessThanOrEqual(1);
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(result.meta_reasoning.quality_assessment.confidence_level);
    expect(typeof result.meta_reasoning.quality_assessment.identifiable).toBe('boolean');
    expect(typeof result.meta_reasoning.quality_assessment.in_linear_range).toBe('boolean');
    expect(typeof result.meta_reasoning.quality_assessment.graph_quality).toBe('number');
  });

  it('includes diagnostics with issues, warnings, and suggestions', () => {
    const graph = createTestGraph(3);
    const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

    expect(result.meta_reasoning.diagnostics).toBeDefined();
    expect(Array.isArray(result.meta_reasoning.diagnostics.issues)).toBe(true);
    expect(Array.isArray(result.meta_reasoning.diagnostics.warnings)).toBe(true);
    expect(Array.isArray(result.meta_reasoning.diagnostics.suggestions)).toBe(true);
  });

  it('includes reliability assessment', () => {
    const graph = createTestGraph(3);
    const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

    expect(result.meta_reasoning.reliability).toBeDefined();
    expect(['stable', 'moderate', 'volatile']).toContain(result.meta_reasoning.reliability.estimate_stability);
    expect(typeof result.meta_reasoning.reliability.sensitivity_flag).toBe('boolean');
    expect(['converged', 'marginal', 'not_converged']).toContain(result.meta_reasoning.reliability.convergence_status);
  });

  it('marks engine in meta', () => {
    const graph = createTestGraph(3);
    const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

    expect(result.meta?.engine).toBe('model_of_inference');
  });

  it('suggests increasing k_samples when low', () => {
    const graph = createTestGraph(3);
    const config: InferenceConfig = {
      ...defaultConfig,
      k_samples: 100, // Below 1000 threshold
    };
    const result = modelOfInferenceEngine.run(graph, config) as MetaReasoningResult;

    // Should suggest increasing samples
    const hasSampleSuggestion = result.meta_reasoning.diagnostics.suggestions.some(
      (s) => s.includes('sample count') || s.includes('1000')
    );
    expect(hasSampleSuggestion).toBe(true);
  });

  it('handles single node graph', () => {
    const graph: Graph = {
      nodes: [{ id: 'outcome', label: 'Outcome' }],
      edges: [],
    };
    const config: InferenceConfig = {
      ...defaultConfig,
      outcome_node: 'outcome',
    };

    // Should not throw
    const result = modelOfInferenceEngine.run(graph, config) as MetaReasoningResult;
    expect(result.meta_reasoning).toBeDefined();
  });

  it('produces deterministic results for same inputs', () => {
    const graph = createTestGraph(4);
    const config: InferenceConfig = { ...defaultConfig, seed: 12345 };

    const result1 = modelOfInferenceEngine.run(graph, config) as MetaReasoningResult;
    const result2 = modelOfInferenceEngine.run(graph, config) as MetaReasoningResult;

    expect(result1.meta_reasoning.quality_assessment.overall_score).toBe(
      result2.meta_reasoning.quality_assessment.overall_score
    );
    expect(result1.meta_reasoning.quality_assessment.confidence_level).toBe(
      result2.meta_reasoning.quality_assessment.confidence_level
    );
  });

  it('assesses stability based on band spread', () => {
    const graph = createTestGraph(5);
    const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

    // With default simulation, bands should be relatively tight
    expect(['stable', 'moderate', 'volatile']).toContain(result.meta_reasoning.reliability.estimate_stability);
  });

  describe('quality assessment boundaries', () => {
    it('overall_score is between 0 and 1', () => {
      const graph = createTestGraph(6);
      const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

      expect(result.meta_reasoning.quality_assessment.overall_score).toBeGreaterThanOrEqual(0);
      expect(result.meta_reasoning.quality_assessment.overall_score).toBeLessThanOrEqual(1);
    });

    it('graph_quality is between 0 and 1', () => {
      const graph = createTestGraph(4);
      const result = modelOfInferenceEngine.run(graph, defaultConfig) as MetaReasoningResult;

      expect(result.meta_reasoning.quality_assessment.graph_quality).toBeGreaterThanOrEqual(0);
      expect(result.meta_reasoning.quality_assessment.graph_quality).toBeLessThanOrEqual(1);
    });
  });
});
