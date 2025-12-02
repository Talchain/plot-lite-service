/**
 * Insight Reference Helpers
 *
 * Utilities for building structured insights with node and edge references.
 * Follows patterns from top_drivers and explain_delta for consistency.
 */

import type {
  NodeReference,
  EdgeReference,
  StructuredInsight,
} from '../types/structured-insights.js';
import type { GraphNode } from '../trust/types.js';

/**
 * Build node reference from ID by looking up label in graph
 *
 * @param nodeId - Node identifier to resolve
 * @param nodes - Graph nodes for label lookup
 * @returns Node reference or null if not found
 *
 * @example
 * ```typescript
 * const ref = buildNodeReference('price', [
 *   { id: 'price', label: 'Price' }
 * ]);
 * // Returns: { node_id: 'price', node_label: 'Price' }
 * ```
 */
export function buildNodeReference(
  nodeId: string,
  nodes: GraphNode[]
): NodeReference | null {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    return null;
  }

  return {
    node_id: nodeId,
    node_label: node.label,
  };
}

/**
 * Build edge reference from IDs by looking up labels in graph
 *
 * @param fromId - Source node identifier
 * @param toId - Target node identifier
 * @param nodes - Graph nodes for label lookup
 * @returns Edge reference or null if nodes not found
 *
 * @example
 * ```typescript
 * const ref = buildEdgeReference('price', 'revenue', nodes);
 * // Returns: { from_id: 'price', from_label: 'Price', to_id: 'revenue', to_label: 'Revenue' }
 * ```
 */
export function buildEdgeReference(
  fromId: string,
  toId: string,
  nodes: GraphNode[]
): EdgeReference | null {
  const fromNode = nodes.find((n) => n.id === fromId);
  const toNode = nodes.find((n) => n.id === toId);

  if (!fromNode || !toNode) {
    return null;
  }

  return {
    from_id: fromId,
    from_label: fromNode.label,
    to_id: toId,
    to_label: toNode.label,
  };
}

/**
 * Create structured insight with node references
 *
 * @param text - Insight text (use neutral language like "this node" instead of specific labels)
 * @param nodeIds - Node identifiers to reference
 * @param nodes - Graph nodes for label resolution
 * @returns Structured insight with resolved node references
 *
 * @example
 * ```typescript
 * const insight = createNodeInsight(
 *   "Focus validation on this primary driver",
 *   ['marketing'],
 *   nodes
 * );
 * ```
 */
export function createNodeInsight(
  text: string,
  nodeIds: string[],
  nodes: GraphNode[]
): StructuredInsight {
  const node_references = nodeIds
    .map((id) => buildNodeReference(id, nodes))
    .filter((ref): ref is NodeReference => ref !== null);

  return {
    text,
    node_references: node_references.length > 0 ? node_references : undefined,
  };
}

/**
 * Create structured insight with edge references
 *
 * @param text - Insight text (use neutral language like "this edge" instead of specific labels)
 * @param edges - Edge specifications (from/to pairs)
 * @param nodes - Graph nodes for label resolution
 * @returns Structured insight with resolved edge references
 *
 * @example
 * ```typescript
 * const insight = createEdgeInsight(
 *   "Low evidence for this critical path",
 *   [{ from: 'marketing', to: 'revenue' }],
 *   nodes
 * );
 * ```
 */
export function createEdgeInsight(
  text: string,
  edges: Array<{ from: string; to: string }>,
  nodes: GraphNode[]
): StructuredInsight {
  const edge_references = edges
    .map((e) => buildEdgeReference(e.from, e.to, nodes))
    .filter((ref): ref is EdgeReference => ref !== null);

  return {
    text,
    edge_references: edge_references.length > 0 ? edge_references : undefined,
  };
}

/**
 * Create structured insight with both node and edge references
 *
 * @param text - Insight text
 * @param nodeIds - Node identifiers to reference
 * @param edges - Edge specifications
 * @param nodes - Graph nodes for label resolution
 * @returns Structured insight with both reference types
 */
export function createMixedInsight(
  text: string,
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  nodes: GraphNode[]
): StructuredInsight {
  const node_references = nodeIds
    .map((id) => buildNodeReference(id, nodes))
    .filter((ref): ref is NodeReference => ref !== null);

  const edge_references = edges
    .map((e) => buildEdgeReference(e.from, e.to, nodes))
    .filter((ref): ref is EdgeReference => ref !== null);

  return {
    text,
    node_references: node_references.length > 0 ? node_references : undefined,
    edge_references: edge_references.length > 0 ? edge_references : undefined,
  };
}
