/**
 * Non-Causal Node Filtering
 *
 * In the canonical model, option and decision nodes are UI scaffolding only.
 * They must be filtered from the graph before causal analysis.
 *
 * This module removes:
 * - Nodes with kind='option' or kind='decision' (non-causal kinds)
 * - All edges incident to those nodes (both incoming and outgoing)
 *
 * Uses EXCLUSION-based filtering (not allow-list) to avoid accidentally
 * dropping new causal kinds added later.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type { EngineGraphV3, EngineNodeV3, EngineEdgeV3 } from '../types/engine-v3.js';
import { NON_CAUSAL_NODE_KINDS } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Result of non-causal node filtering.
 */
export interface FilterResult {
  /** Graph with non-causal nodes and incident edges removed */
  filteredGraph: EngineGraphV3;
  /** IDs of removed non-causal nodes */
  removedNodeIds: Set<string>;
  /** Count of removed edges */
  removedEdgeCount: number;
}

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

/**
 * Check if a node kind is non-causal (should be filtered).
 * Uses exclusion-based filtering to avoid dropping new causal kinds.
 *
 * @param kind Node kind to check
 * @returns True if node is non-causal and should be filtered
 */
function isNonCausalKind(kind: string): boolean {
  const normalizedKind = kind.toLowerCase();
  return NON_CAUSAL_NODE_KINDS.some((k) => k === normalizedKind);
}

/**
 * Filter non-causal nodes and incident edges from the graph.
 *
 * Non-causal nodes (kind='option' or kind='decision') are UI scaffolding
 * that represent decision choices. In the canonical model, options are passed
 * separately as intervention bundles, not as graph nodes.
 *
 * This function:
 * 1. Identifies all nodes with non-causal kinds (option, decision)
 * 2. Removes those nodes from the graph
 * 3. Removes ALL edges incident to those nodes (both incoming and outgoing)
 *
 * @param graph Normalized graph (may contain non-causal nodes)
 * @returns Filtered graph and stats
 */
export function filterOptionNodes(graph: EngineGraphV3): FilterResult {
  // Identify non-causal nodes using exclusion-based filtering
  const nonCausalNodeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (isNonCausalKind(node.kind as string)) {
      nonCausalNodeIds.add(node.id);
    }
  }

  // If no non-causal nodes, return original graph
  if (nonCausalNodeIds.size === 0) {
    return {
      filteredGraph: graph,
      removedNodeIds: nonCausalNodeIds,
      removedEdgeCount: 0,
    };
  }

  // Filter nodes - remove non-causal nodes
  const filteredNodes: EngineNodeV3[] = graph.nodes.filter(
    (node) => !nonCausalNodeIds.has(node.id)
  );

  // Filter edges - remove any edge incident to a non-causal node
  const originalEdgeCount = graph.edges.length;
  const filteredEdges: EngineEdgeV3[] = graph.edges.filter((edge) => {
    const fromIsNonCausal = nonCausalNodeIds.has(edge.from);
    const toIsNonCausal = nonCausalNodeIds.has(edge.to);
    return !fromIsNonCausal && !toIsNonCausal;
  });

  const removedEdgeCount = originalEdgeCount - filteredEdges.length;

  return {
    filteredGraph: {
      nodes: filteredNodes,
      edges: filteredEdges,
    },
    removedNodeIds: nonCausalNodeIds,
    removedEdgeCount,
  };
}

/**
 * Check if a graph contains any non-causal nodes.
 *
 * Useful for early detection before full filtering.
 *
 * @param graph Graph to check
 * @returns True if graph contains non-causal nodes
 */
export function hasOptionNodes(graph: EngineGraphV3): boolean {
  return graph.nodes.some((node) => isNonCausalKind(node.kind as string));
}

/**
 * Count non-causal nodes in a graph without filtering.
 *
 * @param graph Graph to check
 * @returns Count of non-causal nodes
 */
export function countOptionNodes(graph: EngineGraphV3): number {
  return graph.nodes.filter((node) => isNonCausalKind(node.kind as string)).length;
}

/**
 * Filter for ISL translation.
 * Convenience function that calls filterOptionNodes and returns just the graph.
 *
 * @param graph Graph to filter
 * @returns Filtered graph ready for ISL
 */
export function filterForISL(graph: EngineGraphV3): EngineGraphV3 {
  return filterOptionNodes(graph).filteredGraph;
}
