import { VALID_NODE_KINDS, type NodeKind } from '../trust/types.js';

// Normalize edge: map confidence|probability → belief
// addDefaultBelief: if true, set belief=1.0 when undefined (emit-only)
export function normalizeEdge(edge: any, addDefaultBelief = false): any {
  const e = { ...edge };
  if (e.confidence !== undefined) {
    e.belief = e.confidence;
    delete e.confidence;
  } else if (e.probability !== undefined) {
    e.belief = e.probability;
    delete e.probability;
  }
  if (addDefaultBelief && e.belief === undefined) e.belief = 1.0;
  return e;
}

/**
 * Normalize node: map deprecated `type` → `kind`
 * @returns Normalized node and optional warning if kind is invalid
 *
 * P0 Contract: Only sets `kind` if the value is valid per OpenAPI enum.
 * Invalid values generate a warning but are NOT emitted to responses.
 */
export function normalizeNode(node: any): { node: any; warning?: string } {
  const n = { ...node };
  let warning: string | undefined;

  // Map deprecated type → kind (if kind not already set)
  if (n.kind === undefined && n.type !== undefined) {
    // Only set kind if it's a valid enum value (P0: never emit invalid kinds)
    if (VALID_NODE_KINDS.includes(n.type as NodeKind)) {
      n.kind = n.type;
    } else {
      // Invalid type value - generate warning but don't set kind
      warning = `Invalid node kind '${n.type}' for node '${n.id}'. Valid values: ${VALID_NODE_KINDS.join(', ')}`;
    }
    // Keep type for backward compatibility (deprecated)
  }

  // Validate kind if already set (e.g., user provided kind directly)
  if (n.kind !== undefined && !VALID_NODE_KINDS.includes(n.kind as NodeKind)) {
    warning = `Invalid node kind '${n.kind}' for node '${n.id}'. Valid values: ${VALID_NODE_KINDS.join(', ')}`;
    // Remove invalid kind to maintain contract compliance
    delete n.kind;
  }

  return { node: n, warning };
}

export interface NormalizeGraphResult {
  graph: any;
  warnings: string[];
}

export function normalizeGraph(graph: any, addDefaultBelief = false): any {
  if (!graph) return graph;

  const result: NormalizeGraphResult = {
    graph: { ...graph },
    warnings: []
  };

  // Normalize nodes (type → kind mapping)
  if (graph.nodes) {
    const normalizedNodes: any[] = [];
    for (const node of graph.nodes) {
      const { node: normalizedNode, warning } = normalizeNode(node);
      normalizedNodes.push(normalizedNode);
      if (warning) {
        result.warnings.push(warning);
      }
    }
    result.graph.nodes = normalizedNodes;
  }

  // Normalize edges
  if (graph.edges) {
    result.graph.edges = graph.edges.map((e: any) => normalizeEdge(e, addDefaultBelief));
  }

  return result.graph;
}

/**
 * Normalize graph with warnings returned
 * Use this when you need to capture validation warnings
 */
export function normalizeGraphWithWarnings(graph: any, addDefaultBelief = false): NormalizeGraphResult {
  if (!graph) return { graph, warnings: [] };

  const warnings: string[] = [];
  const normalizedGraph: any = { ...graph };

  // Normalize nodes (type → kind mapping)
  if (graph.nodes) {
    const normalizedNodes: any[] = [];
    for (const node of graph.nodes) {
      const { node: normalizedNode, warning } = normalizeNode(node);
      normalizedNodes.push(normalizedNode);
      if (warning) {
        warnings.push(warning);
      }
    }
    normalizedGraph.nodes = normalizedNodes;
  }

  // Normalize edges
  if (graph.edges) {
    normalizedGraph.edges = graph.edges.map((e: any) => normalizeEdge(e, addDefaultBelief));
  }

  return { graph: normalizedGraph, warnings };
}
