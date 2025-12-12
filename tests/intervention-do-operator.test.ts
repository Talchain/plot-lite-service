/**
 * Tests for intervention semantics (do-operator) in SCM-Lite kernel
 *
 * Pearl's do-calculus: When we intervene on X (do(X=x)), we:
 * 1. Cut all incoming edges to X
 * 2. Set X to a fixed value x
 * 3. Propagate effects downstream naturally
 *
 * This differs from observation (P(Y|X)) which conditions on X
 * but leaves the graph structure intact, so confounders still influence Y.
 */
import { describe, it, expect } from 'vitest';
import { runKernel } from '../src/scm-lite/kernel.js';
import type { DAG, Intervention } from '../src/scm-lite/types.js';

describe('Intervention Semantics (do-operator)', () => {
  // Simple chain: A -> B -> C
  // Intervention on B should cut the A->B edge
  const simpleChainDag: DAG = {
    nodes: [
      { id: 'A', label: 'Cause' },
      { id: 'B', label: 'Mediator' },
      { id: 'C', label: 'Effect' },
    ],
    edges: [
      { from: 'A', to: 'B', belief: 1.0, weight: 2.0 },
      { from: 'B', to: 'C', belief: 1.0, weight: 3.0 },
    ],
  };

  // Classic confounding structure: U -> X, U -> Y, X -> Y
  // X and Y share a common cause U (the confounder)
  // Under observation: P(Y|X) reflects both X->Y and U->Y paths
  // Under intervention: P(Y|do(X)) only reflects X->Y
  const confounderDag: DAG = {
    nodes: [
      { id: 'U', label: 'Confounder' },
      { id: 'X', label: 'Treatment' },
      { id: 'Y', label: 'Outcome' },
    ],
    edges: [
      { from: 'U', to: 'X', belief: 1.0, weight: 2.0 }, // Confounder affects treatment
      { from: 'U', to: 'Y', belief: 1.0, weight: 3.0 }, // Confounder affects outcome
      { from: 'X', to: 'Y', belief: 1.0, weight: 1.0 }, // Direct causal effect
    ],
  };

  // Fork structure: X <- U -> Y (no direct X->Y edge)
  // Pure confounding: X and Y are not causally related
  // Under observation: P(Y|X) shows spurious correlation via U
  // Under intervention: P(Y|do(X)) = P(Y) (X has no effect on Y)
  const pureForkDag: DAG = {
    nodes: [
      { id: 'U', label: 'Common cause' },
      { id: 'X', label: 'Spurious cause' },
      { id: 'Y', label: 'Outcome' },
    ],
    edges: [
      { from: 'U', to: 'X', belief: 1.0, weight: 2.0 },
      { from: 'U', to: 'Y', belief: 1.0, weight: 3.0 },
    ],
  };

  // Decision tree: multiple options leading to same outcome
  // option_1, option_2 -> outcome
  // This represents a decision point where we intervene to select an option
  const decisionTreeDag: DAG = {
    nodes: [
      { id: 'context', label: 'Market context' },
      { id: 'option_1', label: 'Price £49' },
      { id: 'option_2', label: 'Price £59' },
      { id: 'revenue', label: 'Revenue' },
    ],
    edges: [
      { from: 'context', to: 'option_1', belief: 1.0, weight: 1.0 },
      { from: 'context', to: 'option_2', belief: 1.0, weight: 1.0 },
      { from: 'option_1', to: 'revenue', belief: 1.0, weight: 0.8 },
      { from: 'option_2', to: 'revenue', belief: 1.0, weight: 1.2 },
    ],
  };

  describe('simple intervention', () => {
    it('should set intervened node to specified value', () => {
      const interventions: Intervention[] = [{ node_id: 'B', value: 10 }];

      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions,
        mode: 'interventional',
      });

      // With B fixed at 10 and B->C weight of 3.0
      // C should be 10 * 3.0 = 30
      expect(result.quantiles.p50).toBe(30);
      expect(result.meta.inference_mode).toBe('interventional');
      expect(result.meta.intervention_count).toBe(1);
    });

    it('should cut incoming edges to intervened node', () => {
      // Without intervention: A->B->C, A contributes
      const withoutIntervention = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        mode: 'interventional',
      });

      // With intervention on B: A is cut, B is fixed
      const withIntervention = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: 5 }],
        mode: 'interventional',
      });

      // Results should differ because intervention cuts A's influence
      expect(withIntervention.quantiles.p50).toBe(15); // 5 * 3.0 = 15
      expect(withIntervention.quantiles.p50).not.toBe(withoutIntervention.quantiles.p50);
    });

    it('should propagate intervention effects downstream', () => {
      // Intervene on A (root node)
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'A', value: 4 }],
        mode: 'interventional',
      });

      // A=4 -> B=4*2=8 -> C=8*3=24
      expect(result.quantiles.p50).toBe(24);
    });
  });

  describe('intervention with confounders', () => {
    it('should show different results for do(X) vs observe(X)', () => {
      // Interventional: P(Y | do(X=5))
      // Cuts U->X edge, so X is fixed at 5
      // But U->Y is still active: U gets baseline 1, so U->Y contributes 1*3=3
      // And X->Y contributes 5*1=5
      // Total Y = 3 + 5 = 8
      const interventional = runKernel(confounderDag, 'Y', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'X', value: 5 }],
        mode: 'interventional',
      });

      // Without intervention, natural graph:
      // U=1 (baseline), X=U*2=2, Y=U*3+X*1=3+2=5
      const natural = runKernel(confounderDag, 'Y', {
        seed: 42,
        K: 64,
        mode: 'interventional',
      });

      // Intervention changes X from natural value (2) to forced value (5)
      // This changes Y from 5 to 8 (only the X->Y contribution changes)
      expect(interventional.quantiles.p50).toBe(8); // U*3 + X*1 = 3 + 5 = 8
      expect(natural.quantiles.p50).toBe(5); // U*3 + X*1 = 3 + 2 = 5
      expect(interventional.quantiles.p50).not.toBe(natural.quantiles.p50);
      expect(interventional.meta.inference_mode).toBe('interventional');
    });

    it('should eliminate spurious correlation in fork structure', () => {
      // In pure fork (U->X, U->Y), X has no causal effect on Y
      // Intervention on X should not change Y at all

      // Without intervention (natural)
      const natural = runKernel(pureForkDag, 'Y', {
        seed: 42,
        K: 64,
        mode: 'interventional',
      });

      // With intervention on X (should not affect Y)
      const withIntervention = runKernel(pureForkDag, 'Y', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'X', value: 100 }],
        mode: 'interventional',
      });

      // X has no path to Y, so intervention on X shouldn't change Y
      // Y only depends on U
      expect(withIntervention.quantiles.p50).toBe(natural.quantiles.p50);
    });
  });

  describe('multiple interventions', () => {
    it('should support intervening on multiple nodes', () => {
      const interventions: Intervention[] = [
        { node_id: 'A', value: 3 },
        { node_id: 'B', value: 7 },
      ];

      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions,
        mode: 'interventional',
      });

      // B is intervened to 7, B->C weight is 3.0
      // A's intervention doesn't matter because B is also intervened (cuts A->B)
      // C = 7 * 3.0 = 21
      expect(result.quantiles.p50).toBe(21);
      expect(result.meta.intervention_count).toBe(2);
    });

    it('should handle decision tree option selection', () => {
      // To properly select an option, we intervene on BOTH options:
      // Set selected option to a value, set other option to 0

      // Intervene to "select" option_1: set option_1=10, option_2=0
      const selectOption1 = runKernel(decisionTreeDag, 'revenue', {
        seed: 42,
        K: 64,
        interventions: [
          { node_id: 'option_1', value: 10 },
          { node_id: 'option_2', value: 0 },
        ],
        mode: 'interventional',
      });

      // Intervene to "select" option_2: set option_1=0, option_2=10
      const selectOption2 = runKernel(decisionTreeDag, 'revenue', {
        seed: 42,
        K: 64,
        interventions: [
          { node_id: 'option_1', value: 0 },
          { node_id: 'option_2', value: 10 },
        ],
        mode: 'interventional',
      });

      // Option 1: 10 * 0.8 + 0 * 1.2 = 8
      // Option 2: 0 * 0.8 + 10 * 1.2 = 12
      // Note: option_2 path is better
      expect(selectOption1.quantiles.p50).toBe(8);
      expect(selectOption2.quantiles.p50).toBe(12);
      expect(selectOption2.quantiles.p50).toBeGreaterThan(selectOption1.quantiles.p50);
    });
  });

  describe('mode selection', () => {
    it('should default to interventional mode', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: 5 }],
        // mode not specified - should default to interventional
      });

      // Should be interventional by default
      expect(result.meta.inference_mode).toBe('interventional');
    });

    it('should not apply interventions in observational mode', () => {
      // In observational mode, interventions array is provided but not applied
      const observational = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: 5 }],
        mode: 'observational',
      });

      // Natural result (no interventions)
      const natural = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
      });

      // Interventional result
      const interventional = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: 5 }],
        mode: 'interventional',
      });

      // Observational should match natural (interventions not applied)
      expect(observational.quantiles.p50).toBe(natural.quantiles.p50);
      // But different from interventional (where B is set to 5)
      expect(observational.quantiles.p50).not.toBe(interventional.quantiles.p50);
      // Meta records that observational mode was used
      expect(observational.meta.inference_mode).toBe('observational');
      // But intervention_count is 0 since interventions weren't applied
      expect(observational.meta.intervention_count).toBe(0);
    });

    it('should produce deterministic results with same seed', () => {
      const config = {
        seed: 12345,
        K: 64,
        interventions: [{ node_id: 'B', value: 7 }] as Intervention[],
        mode: 'interventional' as const,
      };

      const result1 = runKernel(simpleChainDag, 'C', config);
      const result2 = runKernel(simpleChainDag, 'C', config);

      expect(result1.quantiles.p50).toBe(result2.quantiles.p50);
      expect(result1.bma_hash).toBe(result2.bma_hash);
    });
  });

  describe('meta fields', () => {
    it('should include inference_mode when interventions present', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: 5 }],
        mode: 'interventional',
      });

      expect(result.meta.inference_mode).toBe('interventional');
    });

    it('should include intervention_count when interventions present', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [
          { node_id: 'A', value: 3 },
          { node_id: 'B', value: 5 },
        ],
        mode: 'interventional',
      });

      expect(result.meta.intervention_count).toBe(2);
    });

    it('should not include intervention meta when no interventions', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
      });

      expect(result.meta.inference_mode).toBeUndefined();
      expect(result.meta.intervention_count).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle intervention on target node', () => {
      // Intervene directly on the target
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'C', value: 42 }],
        mode: 'interventional',
      });

      // Target is directly set to intervention value
      expect(result.quantiles.p50).toBe(42);
    });

    it('should handle intervention on root node', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'A', value: 2 }],
        mode: 'interventional',
      });

      // A=2 -> B=2*2=4 -> C=4*3=12
      expect(result.quantiles.p50).toBe(12);
    });

    it('should handle zero intervention value', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: 0 }],
        mode: 'interventional',
      });

      // B=0 -> C would be 0*3=0, but kernel uses baseline 1 when sum is 0
      // This is a design choice to prevent propagation of zeros
      expect(result.quantiles.p50).toBe(1);
    });

    it('should handle negative intervention value', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'B', value: -5 }],
        mode: 'interventional',
      });

      // B=-5 -> C=-5*3=-15
      expect(result.quantiles.p50).toBe(-15);
    });

    it('should handle intervention on non-existent node gracefully', () => {
      // Intervening on non-existent node should be ignored
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'non_existent', value: 100 }],
        mode: 'interventional',
      });

      // Should complete without error
      expect(result.meta.intervention_count).toBe(1);
    });

    it('should handle empty interventions array', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 64,
        interventions: [],
        mode: 'interventional',
      });

      // No interventions applied
      expect(result.meta.inference_mode).toBeUndefined();
    });
  });

  describe('integration with adaptive K', () => {
    it('should work with adaptive K early-stopping', () => {
      const result = runKernel(simpleChainDag, 'C', {
        seed: 42,
        K: 256,
        interventions: [{ node_id: 'B', value: 10 }],
        mode: 'interventional',
        adaptiveK: true,
        convergenceThreshold: 0.01,
        kMin: 16,
        kStep: 8,
      });

      // With intervention, result is deterministic (10 * 3 = 30)
      // So should converge very quickly
      expect(result.quantiles.p50).toBe(30);
      expect(result.meta.K_requested).toBe(256);
      expect(result.meta.K_converged).toBe(true);
      expect(result.meta.K_evaluated).toBeLessThan(256);
      expect(result.meta.inference_mode).toBe('interventional');
    });
  });
});
