/**
 * Primary Outcome Detection
 *
 * Automatically detects the primary outcome node for ranking when not specified.
 * Uses a tiered strategy with fallback to existing behaviour.
 */

import type { NodeKind } from '../../trust/types.js';

interface GraphNode {
  id: string;
  label?: string;
  kind?: NodeKind;
}

interface GraphEdge {
  from: string;
  to: string;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DetectionResult {
  /** Detected primary outcome node ID, or null if ambiguous */
  node_id: string | null;
  /** True if detection succeeded */
  detected: boolean;
  /** Strategy used for detection */
  strategy: 'terminal_outcome' | 'single_goal' | 'last_node_fallback' | 'ambiguous';
  /** All outcome nodes found (for utility_suggestion) */
  outcome_nodes: string[];
}

/**
 * Detect primary outcome node for ranking.
 *
 * Strategy order:
 * 1. Terminal outcome nodes (no outgoing edges) - if exactly one
 * 2. Goal nodes - if exactly one
 * 3. Last node fallback (if outcome or goal kind) - backward compatibility
 * 4. Ambiguous - require explicit specification
 *
 * @param graph - Graph with nodes and edges
 * @returns Detection result with node_id and metadata
 */
export function detectPrimaryOutcome(graph: Graph): DetectionResult {
  const outcomeNodes = graph.nodes.filter((n) => n.kind === 'outcome');
  const outcomeNodeIds = outcomeNodes.map((n) => n.id);

  // Strategy 1: Find terminal outcome nodes (no outgoing edges)
  const terminalOutcomes = outcomeNodes.filter(
    (n) => !graph.edges.some((e) => e.from === n.id)
  );

  if (terminalOutcomes.length === 1) {
    return {
      node_id: terminalOutcomes[0].id,
      detected: true,
      strategy: 'terminal_outcome',
      outcome_nodes: outcomeNodeIds,
    };
  }

  // Strategy 2: Find goal nodes
  const goalNodes = graph.nodes.filter((n) => n.kind === 'goal');
  if (goalNodes.length === 1) {
    return {
      node_id: goalNodes[0].id,
      detected: true,
      strategy: 'single_goal',
      outcome_nodes: outcomeNodeIds,
    };
  }

  // Strategy 3: Fallback to last node (backward compatibility)
  if (graph.nodes.length > 0) {
    const lastNode = graph.nodes[graph.nodes.length - 1];
    if (lastNode.kind === 'outcome' || lastNode.kind === 'goal') {
      return {
        node_id: lastNode.id,
        detected: true,
        strategy: 'last_node_fallback',
        outcome_nodes: outcomeNodeIds,
      };
    }
  }

  // Strategy 4: Ambiguous - need explicit specification
  return {
    node_id: null,
    detected: false,
    strategy: 'ambiguous',
    outcome_nodes: outcomeNodeIds,
  };
}

/**
 * Check if utility mode should be suggested.
 *
 * Suggests utility mode when:
 * - Graph has multiple outcome nodes
 * - Simple mode was used (no utility function provided)
 *
 * @param outcomeNodes - List of outcome node IDs
 * @returns Suggestion message if applicable, null otherwise
 */
export function shouldSuggestUtilityMode(outcomeNodes: string[]): {
  applicable: boolean;
  message: string;
} {
  if (outcomeNodes.length > 1) {
    return {
      applicable: true,
      message: `Graph has ${outcomeNodes.length} outcome nodes. Consider specifying utility_function with weights for multi-outcome ranking.`,
    };
  }
  return {
    applicable: false,
    message: '',
  };
}
