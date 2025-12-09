/**
 * Node-Level Sensitivity Aggregation
 *
 * Aggregates edge-level sensitivity scores to the node level,
 * providing a higher-level view of which nodes drive outcome variance.
 *
 * Edge sensitivity is aggregated by source node (from_node), as the
 * source node's value determines the edge's contribution to downstream outcomes.
 */

import type { SensitivityEdge } from '../lib/sensitivity-simple.js';
import type { NodeSensitivity } from '../routes/v1/types/run-bundle.types.js';

/**
 * Node with optional label for display
 */
interface GraphNode {
  id: string;
  label?: string;
}

/**
 * Aggregate edge-level sensitivity to node level.
 *
 * Sums sensitivity scores by source node (from field) and computes
 * percentage contribution to total.
 *
 * @param edges - Edge sensitivity scores from computeSensitivityAll
 * @param nodes - Graph nodes for label lookup
 * @returns Node-level sensitivity sorted by contribution (descending)
 */
export function aggregateNodeSensitivity(
  edges: SensitivityEdge[],
  nodes: GraphNode[]
): NodeSensitivity[] {
  // Build node label lookup
  const nodeLabels = new Map<string, string>();
  for (const node of nodes) {
    nodeLabels.set(node.id, node.label || node.id);
  }

  // Aggregate sensitivity by source node
  const nodeScores = new Map<string, { score: number; count: number }>();

  for (const edge of edges) {
    const nodeId = edge.from;
    const current = nodeScores.get(nodeId) || { score: 0, count: 0 };
    nodeScores.set(nodeId, {
      score: current.score + edge.score,
      count: current.count + 1,
    });
  }

  // Compute total score for percentage calculation
  const totalScore = Array.from(nodeScores.values()).reduce(
    (sum, v) => sum + v.score,
    0
  );

  // Build result array
  const result: NodeSensitivity[] = [];

  for (const [nodeId, { score, count }] of nodeScores) {
    result.push({
      node_id: nodeId,
      node_label: nodeLabels.get(nodeId) || nodeId,
      contribution_pct:
        totalScore > 0 ? Math.round((score / totalScore) * 100) : 0,
      edge_count: count,
    });
  }

  // Sort by contribution (descending)
  result.sort((a, b) => b.contribution_pct - a.contribution_pct);

  return result;
}

/**
 * Get top N nodes by sensitivity contribution.
 *
 * @param edges - Edge sensitivity scores
 * @param nodes - Graph nodes for label lookup
 * @param topN - Number of top nodes to return (default: 5)
 * @returns Top N nodes by contribution
 */
export function getTopNodeSensitivity(
  edges: SensitivityEdge[],
  nodes: GraphNode[],
  topN = 5
): NodeSensitivity[] {
  return aggregateNodeSensitivity(edges, nodes).slice(0, topN);
}
