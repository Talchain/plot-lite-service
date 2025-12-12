/**
 * SCM-Lite Adapter for /v1/run
 * Maps request payload to kernel and adapts results to report.v1
 *
 * Supports intervention semantics (do-operator) for causal inference:
 * - Pass interventions array to set node values and cut incoming edges
 * - Use mode: 'interventional' (default) or 'observational'
 */

import { runKernel } from './kernel.js';
import type { DAG, KernelResult, Intervention, InferenceMode } from './types.js';
import type { Graph } from '../trust/types.js';

export interface AdapterConfig {
  seed: number;
  K: number;
  maxNodes: number;
  beliefDefault: number;
  // Adaptive K early-stopping
  adaptiveK?: boolean;
  convergenceThreshold?: number;
  // Intervention semantics (do-operator)
  interventions?: Intervention[];
  mode?: InferenceMode;
}

export interface AdaptedResults {
  summary: {
    bands: {
      p10: number;
      p50: number;
      p90: number;
    };
  };
  confidence: 'low' | 'medium' | 'high';
  bma_hash: string;
  meta: {
    K_evaluated: number;
    K_requested?: number;
    K_converged?: boolean;
    unique_graphs: number;
    sign_stability: number;
    identified_paths: number;
    // Intervention semantics
    inference_mode?: InferenceMode;
    intervention_count?: number;
  };
}

export function adaptGraphToDAG(graph: Graph, beliefDefault: number = 0.7): DAG {
  const nodes = graph.nodes.map(n => ({ id: n.id, label: n.label }));
  const edges = graph.edges.map(e => ({
    from: e.from,
    to: e.to,
    belief: beliefDefault, // Use default since Graph doesn't have belief field
    weight: e.weight,
  }));
  return { nodes, edges };
}

export function runSCMLite(
  graph: Graph,
  target: string,
  config: AdapterConfig
): AdaptedResults {
  const dag = adaptGraphToDAG(graph, config.beliefDefault);

  const result: KernelResult = runKernel(dag, target, {
    seed: config.seed,
    K: config.K,
    maxNodes: config.maxNodes,
    beliefDefault: config.beliefDefault,
    // Adaptive K early-stopping
    adaptiveK: config.adaptiveK,
    convergenceThreshold: config.convergenceThreshold,
    // Intervention semantics (do-operator)
    interventions: config.interventions,
    mode: config.mode,
  });

  return {
    summary: {
      bands: {
        p10: result.quantiles.p10,
        p50: result.quantiles.p50,
        p90: result.quantiles.p90,
      },
    },
    confidence: result.confidence,
    bma_hash: result.bma_hash,
    meta: result.meta,
  };
}
