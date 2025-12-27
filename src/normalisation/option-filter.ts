/**
 * Option Node Filtering
 *
 * In the canonical model, option nodes are UI scaffolding only.
 * They must be filtered from the graph before causal analysis.
 *
 * This module removes:
 * - Nodes with kind='option'
 * - All edges incident to option nodes (both incoming and outgoing)
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type { EngineGraphV3, EngineNodeV3, EngineEdgeV3 } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Result of option node filtering.
 */
export interface FilterResult {
  /** Graph with option nodes and incident edges removed */
  filteredGraph: EngineGraphV3;
  /** IDs of removed option nodes */
  removedNodeIds: Set<string>;
  /** Count of removed edges */
  removedEdgeCount: number;
}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

/**
 * Filter option nodes and incident edges from the graph.
 *
 * Option nodes (kind='option') are UI scaffolding that represent
 * decision choices. In the canonical model, options are passed
 * separately as intervention bundles, not as graph nodes.
 *
 * This function:
 * 1. Identifies all nodes with kind='option'
 * 2. Removes those nodes from the graph
 * 3. Removes ALL edges incident to those nodes (both incoming and outgoing)
 *
 * @param graph Normalized graph (may contain option nodes)
 * @returns Filtered graph and stats
 */
export function filterOptionNodes(graph: EngineGraphV3): FilterResult {
  // Identify option nodes
  const optionNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    // Check for 'option' kind (case-insensitive for robustness)
    if ((node.kind as string).toLowerCase() === 'option') {
      optionNodeIds.add(node.id);
    }
  }

  // If no option nodes, return original graph
  if (optionNodeIds.size === 0) {
    return {
      filteredGraph: graph,
      removedNodeIds: optionNodeIds,
      removedEdgeCount: 0,
    };
  }

  // Filter nodes - remove option nodes
  const filteredNodes: EngineNodeV3[] = graph.nodes.filter(
    (node) => !optionNodeIds.has(node.id)
  );

  // Filter edges - remove any edge incident to an option node
  const originalEdgeCount = graph.edges.length;
  const filteredEdges: EngineEdgeV3[] = graph.edges.filter((edge) => {
    const fromIsOption = optionNodeIds.has(edge.from);
    const toIsOption = optionNodeIds.has(edge.to);
    return !fromIsOption && !toIsOption;
  });

  const removedEdgeCount = originalEdgeCount - filteredEdges.length;

  return {
    filteredGraph: {
      nodes: filteredNodes,
      edges: filteredEdges,
    },
    removedNodeIds: optionNodeIds,
    removedEdgeCount,
  };
}

/**
 * Check if a graph contains any option nodes.
 *
 * Useful for early detection before full filtering.
 *
 * @param graph Graph to check
 * @returns True if graph contains nodes with kind='option'
 */
export function hasOptionNodes(graph: EngineGraphV3): boolean {
  return graph.nodes.some(
    (node) => (node.kind as string).toLowerCase() === 'option'
  );
}

/**
 * Count option nodes in a graph without filtering.
 *
 * @param graph Graph to check
 * @returns Count of nodes with kind='option'
 */
export function countOptionNodes(graph: EngineGraphV3): number {
  return graph.nodes.filter(
    (node) => (node.kind as string).toLowerCase() === 'option'
  ).length;
}
