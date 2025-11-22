/**
 * Explain-Δ - Top Drivers of Outcome Change
 * Returns human explanation of what moved the outcome and why
 * DETERMINISTIC: No Math.random() - uses stable topology-based fallback
 */

import type { ExplainDelta, Graph } from './types.js';

export interface ExplainDeltaInputs {
  graph: Graph;
  baseline_outcome: number;
  counterfactual_outcome: number;
  node_sensitivities?: Map<string, number>; // node_id -> sensitivity (-1 to 1)
  top_n?: number;
  seed?: number; // For deterministic fallback
  identifiability_method?: 'backdoor' | 'frontdoor' | 'g-formula' | 'unidentifiable';
}

/**
 * Extract top drivers of outcome change with explanations
 * DETERMINISTIC: Uses seed-based fallback if sensitivities not provided
 */
export function buildExplainDelta(inputs: ExplainDeltaInputs): ExplainDelta {
  const {
    graph,
    baseline_outcome,
    counterfactual_outcome,
    node_sensitivities = new Map(),
    top_n = 3,
    seed = 42,
  } = inputs;

  const delta = counterfactual_outcome - baseline_outcome;
  const direction = delta > 0 ? 'increase' : 'decrease';
  const magnitude = Math.abs(delta);

  // Handle zero or near-zero magnitude (no change scenario)
  if (magnitude <= 1e-10) {
    // Sort nodes by ID for deterministic ordering
    const sorted_nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
    const zero_drivers = sorted_nodes.slice(0, top_n).map(node => ({
      node_id: node.id,
      node_label: node.label,
      contribution: 0,
      sign: '+' as const,
      explanation: 'No change from baseline',
    }));

    return {
      top_drivers: zero_drivers,
      summary: 'No change from baseline; all contributions are 0%',
    };
  }

  // If no sensitivities provided, use deterministic fallback
  if (node_sensitivities.size === 0) {
    // DETERMINISTIC: Sort nodes by ID for stable ordering
    const sorted_nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
    
    // Build degree map (in + out degree for each node)
    const degree_map = new Map<string, number>();
    for (const node of sorted_nodes) {
      degree_map.set(node.id, 0);
    }
    for (const edge of graph.edges) {
      degree_map.set(edge.from, (degree_map.get(edge.from) || 0) + 1);
      degree_map.set(edge.to, (degree_map.get(edge.to) || 0) + 1);
    }
    
    // Compute sensitivities deterministically
    for (let i = 0; i < sorted_nodes.length; i++) {
      const node = sorted_nodes[i];
      const degree = degree_map.get(node.id) || 0;
      
      // Deterministic sign from seed + node index
      const sign_hash = (seed + i) % 2 === 0 ? 1 : -1;
      
      // Magnitude from degree (more connected = more influential)
      // Normalize to [0.1, 1.0] range
      const max_degree = Math.max(...Array.from(degree_map.values()));
      const normalized_degree = max_degree > 0 ? degree / max_degree : 0.5;
      const magnitude_factor = 0.1 + (normalized_degree * 0.9);
      
      const sensitivity = sign_hash * magnitude_factor;
      node_sensitivities.set(node.id, sensitivity);
    }
  }

  // Sort nodes by absolute contribution
  const contributions: Array<{
    node_id: string;
    node_label: string;
    contribution: number;
    sign: '+' | '-';
    explanation: string;
  }> = [];

  for (const [node_id, sensitivity] of node_sensitivities.entries()) {
    const node = graph.nodes.find(n => n.id === node_id);
    if (!node) continue;

    const contribution = Math.abs(sensitivity * delta);
    const sign = sensitivity * delta > 0 ? '+' : '-';

    const explanation = generateExplanation({
      node_label: node.label,
      sensitivity,
      delta,
      direction,
    });

    contributions.push({
      node_id,
      node_label: node.label,
      contribution: Math.round((contribution / magnitude) * 100),
      sign,
      explanation,
    });
  }

  // Sort by contribution (descending), then by node_id for stable ties
  contributions.sort((a, b) => {
    if (b.contribution !== a.contribution) {
      return b.contribution - a.contribution;
    }
    // Stable tie-breaker: sort by node_id alphabetically
    return a.node_id.localeCompare(b.node_id);
  });
  const top_drivers = contributions.slice(0, top_n);

  // Build summary
  const top_driver_names = top_drivers.map(d => d.node_label).join(', ');
  let summary = `${magnitude.toFixed(2)} ${direction} driven primarily by: ${top_driver_names}`;
  if (inputs.identifiability_method) {
    summary += ` [identifiability: ${inputs.identifiability_method}]`;
  }

  return {
    top_drivers,
    summary,
  };
}

interface ExplanationInputs {
  node_label: string;
  sensitivity: number;
  delta: number;
  direction: 'increase' | 'decrease';
}

function generateExplanation(inputs: ExplanationInputs): string {
  const { node_label, sensitivity, delta, direction } = inputs;

  const impact = sensitivity > 0 ? 'amplifies' : 'dampens';
  const effect = sensitivity * delta > 0 ? 'contributed positively to' : 'worked against';

  return `${node_label} ${impact} the change and ${effect} the ${direction}`;
}
