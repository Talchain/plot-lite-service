/**
 * Model-Based Inference Engine
 * 
 * Standard probabilistic inference using SCM-Lite or fallback simulation.
 */

import type { Graph } from '../trust/types.js';
import type { InferenceEngine, InferenceConfig, InferenceResult } from './types.js';
import { runSCMLite } from '../scm-lite/adapter.js';

export class ModelBasedInference implements InferenceEngine {
  name = 'model_based';

  run(graph: Graph, config: InferenceConfig): InferenceResult {
    const { seed, k_samples, outcome_node, baseline_value } = config;
    
    // Use SCM-Lite if enabled
    if (process.env.SCM_LITE_ENABLE === '1') {
      const scmConfig = {
        seed,
        K: k_samples || Number(process.env.SCM_LITE_K || 256),
        maxNodes: Number(process.env.SCM_LITE_MAX_NODES || 50),
        maxEdges: Number(process.env.SCM_LITE_MAX_EDGES || 200),
        beliefDefault: Number(process.env.SCM_LITE_BELIEF_DEFAULT || 0.7),
      };
      
      const scmResult = runSCMLite(graph, outcome_node, scmConfig);
      
      return {
        conservative: { outcome: scmResult.summary.bands.p10 },
        most_likely: { outcome: scmResult.summary.bands.p50 },
        optimistic: { outcome: scmResult.summary.bands.p90 },
        meta: {
          unique_graphs: scmResult.meta.unique_graphs,
          sign_stability: scmResult.meta.sign_stability,
          bma_hash: scmResult.bma_hash,
        },
      };
    }
    
    // Fallback: placeholder simulation
    // In production, this should log a warning (handled by caller)
    const current_value = baseline_value * 1.15; // Simple placeholder
    
    return {
      conservative: { outcome: baseline_value * 1.05 },
      most_likely: { outcome: current_value },
      optimistic: { outcome: baseline_value * 1.25 },
    };
  }
}

export const modelBasedInference = new ModelBasedInference();
