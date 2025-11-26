/**
 * Graph Quality Score
 *
 * Computes a 0-1 score representing overall graph quality for decision-making.
 * Weighted factors:
 * - completeness (30%): edge count relative to reasonable maximum
 * - evidence_coverage (30%): edges with provenance / total edges
 * - balance (20%): normalized in-degree variance (penalizes hubs)
 * - identifiability (20%): bonus for identifiable causal structure
 */

export interface GraphQuality {
  score: number; // 0.00–1.00
  completeness: number; // edges / (nodes × 2), capped at 1.0
  evidence_coverage: number; // edges_with_provenance / edges_total
  balance: number; // 1 - normalised_variance(in_degrees)
  issues_count: number;
  recommendation?: string;
}

export interface GraphQualityParams {
  nodes: number;
  edges: number;
  edges_with_provenance: number;
  critique_issues: number;
  identifiable: boolean;
}

/**
 * Compute graph quality score
 *
 * @param params Graph metrics and quality indicators
 * @returns GraphQuality with score and breakdown
 */
export function computeGraphQuality(params: GraphQualityParams): GraphQuality {
  const { nodes, edges, edges_with_provenance, critique_issues, identifiable } = params;

  // Completeness: edges / (nodes × 2), capped at 1.0
  // Using nodes × 2 as "reasonable" edge count for decision graphs
  const reasonableEdges = nodes * 2;
  const completeness =
    reasonableEdges > 0 ? Math.min(edges / reasonableEdges, 1.0) : 0;

  // Evidence coverage: edges_with_provenance / total edges
  const evidence_coverage = edges > 0 ? edges_with_provenance / edges : 0;

  // Balance: simplified - based on density
  // Optimal density is around 30% for decision graphs
  // Density = edges / max_possible_edges where max = n*(n-1)/2
  const maxPossibleEdges = nodes > 1 ? (nodes * (nodes - 1)) / 2 : 1;
  const density = maxPossibleEdges > 0 ? edges / maxPossibleEdges : 0;
  // Penalize deviation from optimal density (0.3)
  // balance = 1 - |density - 0.3| * 2, clamped to [0, 1]
  const balance = Math.max(0, Math.min(1, 1 - Math.abs(density - 0.3) * 2));

  // Identifiability bonus
  const identifiability_score = identifiable ? 1.0 : 0.0;

  // Issues penalty: max 30% reduction
  const issues_penalty = Math.min(critique_issues * 0.05, 0.3);

  // Weighted score (30/30/20/20)
  const rawScore =
    completeness * 0.3 +
    evidence_coverage * 0.3 +
    balance * 0.2 +
    identifiability_score * 0.2;

  // Apply issues penalty
  const score = Number((rawScore * (1 - issues_penalty)).toFixed(2));

  // Generate recommendation if needed
  let recommendation: string | undefined;
  if (evidence_coverage < 0.5) {
    recommendation = 'Add evidence to strengthen key relationships';
  } else if (!identifiable) {
    recommendation = 'Review causal structure for identifiability';
  } else if (critique_issues > 2) {
    recommendation = 'Address critique issues to improve model quality';
  } else if (completeness < 0.5) {
    recommendation = 'Consider adding more relationships to complete the model';
  }

  return {
    score,
    completeness: Number(completeness.toFixed(2)),
    evidence_coverage: Number(evidence_coverage.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    issues_count: critique_issues,
    recommendation,
  };
}
