/**
 * Model-Based Inference Engine
 *
 * Standard probabilistic inference using SCM-Lite or fallback simulation.
 *
 * Supports Pearl's do-operator for intervention semantics:
 * - interventional mode (default): P(Y | do(X)) - cutting incoming edges
 * - observational mode: P(Y | X) - conditioning on observed values
 */

import type { Graph } from '../trust/types.js';
import type { InferenceEngine, InferenceConfig, InferenceResult } from './types.js';
import { runSCMLite } from '../scm-lite/adapter.js';
import { applyPriorsToGraph } from './apply-priors.js';
import { applyEdgeFunction } from '../engine/edge-functions.js';

export class ModelBasedInference implements InferenceEngine {
  name = 'model_based';

  run(graph: Graph, config: InferenceConfig): InferenceResult {
    const {
      seed,
      k_samples,
      outcome_node,
      baseline_value,
      priors,
      adaptiveK,
      convergenceThreshold,
      interventions,
      mode,
    } = config;

    // Apply priors to graph if provided
    const workingGraph = priors ? applyPriorsToGraph(graph, priors, seed) : graph;

    // Use SCM-Lite if enabled
    if (process.env.SCM_LITE_ENABLE === '1') {
      const scmConfig = {
        seed,
        K: k_samples || Number(process.env.SCM_LITE_K || 256),
        maxNodes: Number(process.env.SCM_LITE_MAX_NODES || 50),
        maxEdges: Number(process.env.SCM_LITE_MAX_EDGES || 200),
        beliefDefault: Number(process.env.SCM_LITE_BELIEF_DEFAULT || 0.7),
        // Adaptive K early-stopping
        adaptiveK,
        convergenceThreshold,
        // Intervention semantics (do-operator)
        interventions,
        mode,
      };

      const scmResult = runSCMLite(workingGraph, outcome_node, scmConfig);

      return {
        conservative: { outcome: scmResult.summary.bands.p10 },
        most_likely: { outcome: scmResult.summary.bands.p50 },
        optimistic: { outcome: scmResult.summary.bands.p90 },
        meta: {
          unique_graphs: scmResult.meta.unique_graphs,
          sign_stability: scmResult.meta.sign_stability,
          bma_hash: scmResult.bma_hash,
          K_evaluated: scmResult.meta.K_evaluated,
          K_requested: scmResult.meta.K_requested,
          K_converged: scmResult.meta.K_converged,
          // Intervention semantics
          inference_mode: scmResult.meta.inference_mode,
          intervention_count: scmResult.meta.intervention_count,
        },
      };
    }
    
    // Fallback: simple simulation with priors support
    // In production, this should log a warning (handled by caller)
    const outcome = this.simulateOutcome(workingGraph, outcome_node, baseline_value);
    
    return {
      conservative: { outcome: outcome * 0.95 },
      most_likely: { outcome },
      optimistic: { outcome: outcome * 1.05 },
    };
  }

  /**
   * Simple outcome simulation using graph structure and node values
   * Node values are set by applyPriorsToGraph when priors are provided
   */
  private simulateOutcome(graph: Graph, outcomeNode: string, baseline: number): number {
    // Find outcome node
    const node = graph.nodes.find(n => n.id === outcomeNode);
    if (!node) return baseline;
    
    // Get node value (set by priors, or default to 0.5)
    const nodeValue = (node as any).value ?? 0.5;
    
    // Find incoming edges to outcome node
    const incomingEdges = graph.edges.filter(e => e.to === outcomeNode);
    
    if (incomingEdges.length === 0) {
      // No incoming edges: use node value directly
      return baseline * (0.8 + nodeValue * 0.4);
    }
    
    // Calculate weighted influence from parent nodes
    // Apply non-linear edge functions when specified
    let totalInfluence = 0;
    let totalWeight = 0;

    for (const edge of incomingEdges) {
      const parentNode = graph.nodes.find(n => n.id === edge.from);
      if (parentNode) {
        const parentValue = (parentNode as any).value ?? 0.5;
        const edgeWeight = edge.weight ?? 1.0;
        // Apply non-linear edge function if specified
        const transformedValue = applyEdgeFunction(parentValue, edge);
        totalInfluence += transformedValue * edgeWeight;
        totalWeight += edgeWeight;
      }
    }
    
    // Average influence from parents
    const avgInfluence = totalWeight > 0 ? totalInfluence / totalWeight : 0.5;
    
    // Combine node value (30%) and parent influence (70%)
    const combinedValue = nodeValue * 0.3 + avgInfluence * 0.7;
    
    // Scale baseline by combined value (range: 0.8 to 1.2)
    return baseline * (0.8 + combinedValue * 0.4);
  }
}

export const modelBasedInference = new ModelBasedInference();
