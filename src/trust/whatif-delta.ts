/**
 * Deterministic what-if delta summary (E4)
 * Post-compute analysis of edge perturbation effects
 */

export interface DeltaSummary {
  perturbation: string;
  outcome_delta: number;
}

export function computeDeltaSummary(
  graph: any,
  outcome: string,
  baseValue: number
): DeltaSummary | null {
  if (process.env.WHATIF_DELTA_ENABLE !== '1') {
    return null;
  }
  
  // Deterministic: pick first edge, perturb weight by +0.1
  if (!graph.edges || graph.edges.length === 0) {
    return null;
  }
  
  const edge = graph.edges[0];
  const perturbation = `${edge.from}→${edge.to} weight +0.1`;
  
  // Simplified: delta proportional to edge weight and belief
  const delta = (edge.weight || 0) * (edge.belief || 0.5) * 0.1;
  
  return {
    perturbation,
    outcome_delta: Math.round(delta * 1000) / 1000
  };
}
