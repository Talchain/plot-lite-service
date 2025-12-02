/**
 * Structured Insights Types
 *
 * Provides structured references to graph nodes and edges within insight text,
 * enabling UI to highlight, navigate, and interact with referenced elements.
 */

/**
 * Reference to a specific node in the graph
 */
export interface NodeReference {
  /** Node identifier */
  node_id: string;

  /** Human-readable node label */
  node_label: string;
}

/**
 * Reference to a specific edge in the graph
 */
export interface EdgeReference {
  /** Source node identifier */
  from_id: string;

  /** Source node label */
  from_label: string;

  /** Target node identifier */
  to_id: string;

  /** Target node label */
  to_label: string;
}

/**
 * Structured insight with embedded node/edge references
 *
 * @example
 * ```typescript
 * {
 *   text: "Focus validation on this critical driver",
 *   node_references: [{ node_id: "10", node_label: "Marketing" }]
 * }
 * ```
 */
export interface StructuredInsight {
  /** Insight text (may contain placeholders like "this node") */
  text: string;

  /** Nodes referenced in the text */
  node_references?: NodeReference[];

  /** Edges referenced in the text */
  edge_references?: EdgeReference[];
}

/**
 * Insights collection with structured references
 * Supports both string (backwards compatible) and structured formats
 */
export interface StructuredInsights {
  /** Summary description */
  summary: string;

  /** Recommended next actions */
  next_steps: Array<string | StructuredInsight>;

  /** Identified risks and concerns */
  risks: Array<string | StructuredInsight>;
}

/**
 * Type guard for structured insights
 */
export function isStructuredInsight(
  insight: string | StructuredInsight
): insight is StructuredInsight {
  return typeof insight === 'object' && insight !== null && 'text' in insight;
}
