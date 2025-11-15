/**
 * Apply Priors to Graph
 * 
 * Applies prior beliefs to node values in a deterministic, seeded manner.
 */

import type { Graph } from '../trust/types.js';

export interface PriorValue {
  mean: number;
  sd: number;
}

/**
 * Apply priors to graph nodes
 * Modifies node values based on prior beliefs
 * 
 * @param graph - Graph to modify
 * @param priors - Prior beliefs (number or {mean, sd})
 * @param seed - Random seed for deterministic sampling
 * @returns Modified graph with priors applied
 */
export function applyPriorsToGraph(
  graph: Graph,
  priors: Record<string, number | PriorValue>,
  seed: number
): Graph {
  if (!priors || Object.keys(priors).length === 0) {
    return graph;
  }

  // Seeded random number generator (simple LCG)
  let rngState = seed;
  const seededRandom = (): number => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };

  // Box-Muller transform for normal distribution
  const sampleNormal = (mean: number, sd: number): number => {
    const u1 = seededRandom();
    const u2 = seededRandom();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * sd;
  };

  // Clone graph to avoid mutation
  const modifiedGraph: Graph = {
    ...graph,
    nodes: graph.nodes.map((node: any) => {
      const nodeId = String(node.id);
      const prior = priors[nodeId];

      if (!prior) {
        return node; // No prior for this node
      }

      let priorValue: number;
      if (typeof prior === 'number') {
        // Simple number prior (0-1)
        priorValue = Math.max(0, Math.min(1, prior));
      } else {
        // Distribution prior {mean, sd}
        priorValue = sampleNormal(prior.mean, prior.sd);
        priorValue = Math.max(0, Math.min(1, priorValue)); // Clamp to [0,1]
      }

      // Apply prior to node value
      // If node has existing value, blend with prior (weighted average)
      // Otherwise, set to prior value
      const existingValue = typeof node.value === 'number' ? node.value : null;
      const finalValue = existingValue !== null
        ? existingValue * 0.7 + priorValue * 0.3 // 70% existing, 30% prior
        : priorValue;

      return {
        ...node,
        value: finalValue
      };
    })
  };

  return modifiedGraph;
}
