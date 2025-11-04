/**
 * Extended Graph Schema for Assistants (v04 Spec)
 *
 * Compatible with engine's base Graph type from src/trust/types.ts
 * Extends with v04-specific metadata: version, seed, node kinds, structured provenance
 */

import type { Graph as BaseGraph, GraphNode as BaseNode, GraphEdge as BaseEdge } from '../../trust/types.js';

/**
 * Node kinds per v04 specification
 */
export type NodeKind = 'goal' | 'decision' | 'option' | 'outcome';

/**
 * Structured provenance for document grounding (v04)
 */
export interface ProvenanceSource {
  source: 'brief' | 'document' | 'hypothesis';
  quote?: string;  // ≤100 chars if from doc
  location?: string;  // Page/section/line if from doc
}

/**
 * Extended node with v04 fields
 */
export interface AssistNode extends Omit<BaseNode, 'type'> {
  kind: NodeKind;  // Replaces 'type' for v04
}

/**
 * Extended edge with v04 structured provenance
 */
export interface AssistEdge extends Omit<BaseEdge, 'provenance'> {
  provenance?: ProvenanceSource;  // Structured instead of string
  provenance_source?: string;  // Deprecated: for backward compat
}

/**
 * Graph metadata per v04 specification
 */
export interface GraphMeta {
  roots: string[];  // Root node IDs
  leaves: string[];  // Leaf node IDs
  suggested_positions?: Record<string, { x: number; y: number }>;
  source: 'assistant' | 'user' | 'engine';
}

/**
 * Extended graph with v04 metadata
 */
export interface AssistGraph {
  version: '1';  // Schema version
  default_seed: number;  // Deterministic seed for reproducibility
  nodes: AssistNode[];
  edges: AssistEdge[];
  meta: GraphMeta;
}

/**
 * Convert AssistGraph to engine's base Graph (strips v04 metadata)
 */
export function toBaseGraph(graph: AssistGraph): BaseGraph {
  return {
    nodes: graph.nodes.map(n => ({
      id: n.id,
      label: n.label,
      type: n.kind,  // Map kind → type for engine
    })),
    edges: graph.edges.map(e => ({
      from: e.from,
      to: e.to,
      label: e.label,
      weight: e.weight,
      belief: e.belief,
      // Flatten provenance to string for engine
      provenance: e.provenance
        ? `${e.provenance.source}${e.provenance.quote ? `: "${e.provenance.quote.slice(0, 100)}"` : ''}`
        : undefined,
    })),
  };
}

/**
 * Validate graph constraints per v04 spec
 */
export interface GraphConstraints {
  maxNodes: number;
  maxEdges: number;
}

export const V04_CONSTRAINTS: GraphConstraints = {
  maxNodes: 12,
  maxEdges: 24,
};

/**
 * Check if graph violates v04 constraints
 */
export function checkConstraints(graph: AssistGraph): string[] {
  const violations: string[] = [];

  if (graph.nodes.length > V04_CONSTRAINTS.maxNodes) {
    violations.push(`Graph has ${graph.nodes.length} nodes, max is ${V04_CONSTRAINTS.maxNodes}`);
  }

  if (graph.edges.length > V04_CONSTRAINTS.maxEdges) {
    violations.push(`Graph has ${graph.edges.length} edges, max is ${V04_CONSTRAINTS.maxEdges}`);
  }

  return violations;
}
