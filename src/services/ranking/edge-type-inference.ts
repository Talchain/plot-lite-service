/**
 * Edge Type Inference Service
 *
 * Infers edge_type from node kinds when not explicitly specified.
 * Adds response warnings for inferred types to support migration visibility.
 *
 * Inference table (aligned with Platform Architecture Contract v1.4):
 * | From Kind | To Kind   | Inferred Edge Type |
 * |-----------|-----------|-------------------|
 * | goal      | decision  | functional        |
 * | goal      | outcome   | functional        |
 * | decision  | option    | structural        |
 * | option    | action    | structural        |
 * | option    | outcome   | probabilistic     |
 * | action    | outcome   | probabilistic     |
 * | action    | risk      | probabilistic     |
 * | risk      | outcome   | probabilistic     |
 * | (other)   | (other)   | probabilistic     |
 */

import type { NodeKind, EdgeType, GraphNode, GraphEdge } from '../../trust/types.js';

/**
 * Warning for an inferred edge type
 */
export interface EdgeTypeWarning {
  code: 'EDGE_TYPE_INFERRED';
  message: string;
  edge_id: string;
  from: string;
  to: string;
  inferred_type: EdgeType;
  severity: 'info';
}

/**
 * Result of edge type inference for a graph
 */
export interface EdgeTypeInferenceResult {
  /** Edges with inferred types applied */
  edges: GraphEdge[];
  /** Warnings for edges that had types inferred */
  warnings: EdgeTypeWarning[];
  /** Count of edges that had explicit types */
  explicit_count: number;
  /** Count of edges that had types inferred */
  inferred_count: number;
}

/**
 * Infer edge type from source and target node kinds.
 *
 * @param fromKind - Kind of the source node (undefined if not specified)
 * @param toKind - Kind of the target node (undefined if not specified)
 * @returns Inferred edge type
 */
export function inferEdgeType(
  fromKind: NodeKind | undefined,
  toKind: NodeKind | undefined
): EdgeType {
  // Functional edges: goal -> decision, goal -> outcome
  if (fromKind === 'goal' && (toKind === 'decision' || toKind === 'outcome')) {
    return 'functional';
  }

  // Structural edges: decision -> option, option -> action
  if (fromKind === 'decision' && toKind === 'option') {
    return 'structural';
  }
  if (fromKind === 'option' && toKind === 'action') {
    return 'structural';
  }

  // Probabilistic edges: all outcome-related connections
  if (fromKind === 'option' && toKind === 'outcome') {
    return 'probabilistic';
  }
  if (fromKind === 'action' && (toKind === 'outcome' || toKind === 'risk')) {
    return 'probabilistic';
  }
  if (fromKind === 'risk' && toKind === 'outcome') {
    return 'probabilistic';
  }

  // Default: probabilistic (most common for inference)
  return 'probabilistic';
}

/**
 * Process a graph and infer edge types for edges without explicit types.
 * Returns a new set of edges with types applied and warnings for inferences.
 *
 * @param nodes - Graph nodes with optional kind field
 * @param edges - Graph edges with optional edge_type field
 * @returns Result with processed edges and inference warnings
 */
export function inferEdgeTypes(
  nodes: GraphNode[],
  edges: GraphEdge[]
): EdgeTypeInferenceResult {
  const nodeMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const warnings: EdgeTypeWarning[] = [];
  let explicitCount = 0;
  let inferredCount = 0;

  const processedEdges = edges.map((edge) => {
    // If edge_type is already specified, keep it
    if (edge.edge_type) {
      explicitCount++;
      return edge;
    }

    // Infer from node kinds
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    const inferredType = inferEdgeType(fromNode?.kind, toNode?.kind);

    inferredCount++;
    warnings.push({
      code: 'EDGE_TYPE_INFERRED',
      message: `Edge ${edge.from}->${edge.to} type inferred as '${inferredType}' from node kinds`,
      edge_id: `${edge.from}->${edge.to}`,
      from: edge.from,
      to: edge.to,
      inferred_type: inferredType,
      severity: 'info',
    });

    return {
      ...edge,
      edge_type: inferredType,
    };
  });

  return {
    edges: processedEdges,
    warnings,
    explicit_count: explicitCount,
    inferred_count: inferredCount,
  };
}

/**
 * Validate that an edge type is valid for the given node kinds.
 * Used for explicit edge types to warn about unusual configurations.
 *
 * @param edgeType - The edge type to validate
 * @param fromKind - Source node kind
 * @param toKind - Target node kind
 * @returns True if the edge type is typical for these node kinds
 */
export function isTypicalEdgeType(
  edgeType: EdgeType,
  fromKind: NodeKind | undefined,
  toKind: NodeKind | undefined
): boolean {
  const expected = inferEdgeType(fromKind, toKind);
  return edgeType === expected;
}
