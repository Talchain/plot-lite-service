import type { GraphNode, GraphEdge } from '../trust/types.js';

/**
 * Lightweight graph type used for diffing. Compatible with GraphV1 shapes.
 */
export interface DiffGraph {
  nodes: Array<GraphNode & { [key: string]: any }>;
  edges: Array<(GraphEdge & { id?: string; [key: string]: any })>;
}

export interface FieldChange {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

export interface NodeDiffEntry {
  node: GraphNode & { [key: string]: any };
  changes: FieldChange[];
}

export interface EdgeDiffEntry {
  edge: (GraphEdge & { id?: string; [key: string]: any });
  changes: FieldChange[];
}

export interface GraphDiffSummary {
  total_changes: number;
  significant_changes: number; // weight/belief changes > 0.5
}

export interface GraphDiffResult {
  nodes_added: Array<GraphNode & { [key: string]: any }>;
  nodes_removed: Array<GraphNode & { [key: string]: any }>;
  nodes_modified: NodeDiffEntry[];
  edges_added: Array<GraphEdge & { id?: string; [key: string]: any }>;
  edges_removed: Array<GraphEdge & { id?: string; [key: string]: any }>;
  edges_modified: EdgeDiffEntry[];
  summary: GraphDiffSummary;
}

/**
 * Compute a structural diff between two graphs.
 *
 * - Nodes are matched by id
 * - Edges are matched by id when present, otherwise by from/to pair
 * - Changes are reported per-node / per-edge as field-level deltas
 *
 * The function is pure and does not mutate its inputs.
 */
export function computeGraphDiff(before: DiffGraph, after: DiffGraph): GraphDiffResult {
  const result: GraphDiffResult = {
    nodes_added: [],
    nodes_removed: [],
    nodes_modified: [],
    edges_added: [],
    edges_removed: [],
    edges_modified: [],
    summary: { total_changes: 0, significant_changes: 0 },
  };

  // --- Nodes ---
  const beforeNodesById = new Map<string, GraphNode & { [key: string]: any }>();
  for (const n of before.nodes || []) {
    if (n && typeof n.id === 'string') {
      beforeNodesById.set(n.id, n as any);
    }
  }

  const afterNodesById = new Map<string, GraphNode & { [key: string]: any }>();
  for (const n of after.nodes || []) {
    if (n && typeof n.id === 'string') {
      afterNodesById.set(n.id, n as any);
    }
  }

  // Added nodes: present in `after` but not in `before`
  for (const [id, node] of afterNodesById) {
    if (!beforeNodesById.has(id)) {
      result.nodes_added.push(structuredCloneIfPossible(node));
    }
  }

  // Removed nodes: present in `before` but not in `after`
  for (const [id, node] of beforeNodesById) {
    if (!afterNodesById.has(id)) {
      result.nodes_removed.push(structuredCloneIfPossible(node));
    }
  }

  // Modified nodes: same id, differing fields (ignoring id)
  for (const [id, afterNode] of afterNodesById) {
    const beforeNode = beforeNodesById.get(id);
    if (!beforeNode) continue;

    const changes = compareObjects(beforeNode, afterNode, ['id']);
    if (changes.length > 0) {
      result.nodes_modified.push({
        node: structuredCloneIfPossible(afterNode),
        changes,
      });
    }
  }

  // --- Edges ---
  const beforeEdgesByKey = new Map<string, GraphEdge & { id?: string; [key: string]: any }>();
  for (const e of before.edges || []) {
    if (!e) continue;
    const key = edgeKey(e as any);
    beforeEdgesByKey.set(key, e as any);
  }

  const afterEdgesByKey = new Map<string, GraphEdge & { id?: string; [key: string]: any }>();
  for (const e of after.edges || []) {
    if (!e) continue;
    const key = edgeKey(e as any);
    afterEdgesByKey.set(key, e as any);
  }

  // Added edges
  for (const [key, edge] of afterEdgesByKey) {
    if (!beforeEdgesByKey.has(key)) {
      result.edges_added.push(structuredCloneIfPossible(edge));
    }
  }

  // Removed edges
  for (const [key, edge] of beforeEdgesByKey) {
    if (!afterEdgesByKey.has(key)) {
      result.edges_removed.push(structuredCloneIfPossible(edge));
    }
  }

  // Modified edges
  let significant = 0;
  for (const [key, afterEdge] of afterEdgesByKey) {
    const beforeEdge = beforeEdgesByKey.get(key);
    if (!beforeEdge) continue;

    const changes = compareObjects(beforeEdge, afterEdge, ['id']);
    if (changes.length > 0) {
      result.edges_modified.push({
        edge: structuredCloneIfPossible(afterEdge),
        changes,
      });

      // Significant if weight or belief changes by more than 0.5
      const weightChange = changes.find((c) => c.field === 'weight');
      const beliefChange = changes.find((c) => c.field === 'belief');

      if (
        (weightChange && numericDeltaExceeds(weightChange.old_value, weightChange.new_value, 0.5)) ||
        (beliefChange && numericDeltaExceeds(beliefChange.old_value, beliefChange.new_value, 0.5))
      ) {
        significant += 1;
      }
    }
  }

  result.summary.significant_changes = significant;
  result.summary.total_changes =
    result.nodes_added.length +
    result.nodes_removed.length +
    result.nodes_modified.length +
    result.edges_added.length +
    result.edges_removed.length +
    result.edges_modified.length;

  return result;
}

function edgeKey(edge: { id?: string; from?: string; to?: string }): string {
  if (edge.id && typeof edge.id === 'string') {
    return `id:${edge.id}`;
  }
  const from = typeof edge.from === 'string' ? edge.from : '';
  const to = typeof edge.to === 'string' ? edge.to : '';
  return `from:${from}::to:${to}`;
}

function compareObjects(
  before: Record<string, any>,
  after: Record<string, any>,
  ignoreFields: string[] = [],
): FieldChange[] {
  const ignore = new Set(ignoreFields);
  const fields = new Set<string>([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changes: FieldChange[] = [];

  for (const field of fields) {
    if (ignore.has(field)) continue;

    const beforeVal = before[field];
    const afterVal = after[field];

    // Treat undefined vs missing as equivalent
    const beforeExists = Object.prototype.hasOwnProperty.call(before, field);
    const afterExists = Object.prototype.hasOwnProperty.call(after, field);
    if (!beforeExists && !afterExists) continue;

    if (deepEqual(beforeVal, afterVal)) continue;

    changes.push({
      field,
      old_value: beforeVal,
      new_value: afterVal,
    });
  }

  return changes;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function numericDeltaExceeds(oldVal: unknown, newVal: unknown, threshold: number): boolean {
  if (typeof oldVal !== 'number' || typeof newVal !== 'number') return false;
  return Math.abs(newVal - oldVal) > threshold;
}

function structuredCloneIfPossible<T>(value: T): T {
  try {
    // Node 17+ and modern browsers
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(value);
    }
  } catch {
    // fall through to JSON clone
  }

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}
