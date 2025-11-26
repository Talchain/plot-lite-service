import type { GraphEdge } from '../trust/types.js';

export interface SensitivityEdge {
  edge_id: string;
  from: string;
  to: string;
  label?: string;
  weight: number;
  belief: number;
  provenance: string;
  rank: number;
  score: number;
}

/**
 * Compute sensitivity scores for ALL edges, sorted by impact.
 * Returns full list with ranks assigned.
 */
export function computeSensitivityAll(
  edges: GraphEdge[],
  _targetNode: string
): SensitivityEdge[] {
  const scored = edges.map((edge, idx) => {
    const weight = edge.weight ?? 0;
    const belief = edge.belief ?? 1.0;
    const provenance = edge.provenance ?? 'template';
    const score = Math.abs(weight) * belief;

    return {
      edge_id: `${edge.from}::${edge.to}::${idx}`,
      from: edge.from,
      to: edge.to,
      label: edge.label ?? '',
      weight,
      belief,
      provenance,
      score,
      rank: 0,
    };
  });

  scored.sort((a, b) => {
    const EPS = 1e-12;
    if (Math.abs(a.score - b.score) > EPS) return b.score - a.score;
    const wDiff = Math.abs(b.weight) - Math.abs(a.weight);
    if (Math.abs(wDiff) > EPS) return wDiff;
    return a.edge_id.localeCompare(b.edge_id);
  });

  // Assign ranks to all edges
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Compute sensitivity scores and return only top 3.
 * This is the original function for backward compatibility.
 */
export function computeSensitivitySimple(
  edges: GraphEdge[],
  targetNode: string
): SensitivityEdge[] {
  return computeSensitivityAll(edges, targetNode).slice(0, 3);
}
