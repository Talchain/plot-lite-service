/**
 * Critique with One-Click Fixes
 * Emits issues as BLOCKER / IMPROVEMENT / OBSERVATION
 */

import type { CritiqueItem, Graph } from './types.js';
import { CRITIQUE_CODES } from './critique-codes.js';

export interface CritiqueInputs {
  graph: Graph;
  assumptions?: string[];
  identifiable: boolean;
  node_limit?: number;
}

/**
 * Generate critique with actionable fix suggestions
 */
export function buildCritique(inputs: CritiqueInputs): CritiqueItem[] {
  const {
    graph,
    assumptions = [],
    identifiable,
    node_limit = 12,
  } = inputs;

  const items: CritiqueItem[] = [];

  // Check 1: Graph size
  if (graph.nodes.length > node_limit) {
    items.push({
      code: CRITIQUE_CODES.GRAPH_TOO_LARGE,
      severity: 'BLOCKER',
      semantic_severity: 'ERROR',
      message: `Graph too large: ${graph.nodes.length} nodes (limit: ${node_limit}). Results marked approximate.`,
      suggested_action: 'Simplify model by removing weak edges or grouping nodes',
      auto_fixable: false,
      source: 'engine',
    });
  } else if (graph.nodes.length < 3) {
    items.push({
      severity: 'IMPROVEMENT',
      semantic_severity: 'WARNING',
      message: `Sparse graph: ${graph.nodes.length} nodes. Consider adding intermediate variables.`,
      suggested_action: 'Add mediating factors for richer analysis',
      auto_fixable: false,
      source: 'engine',
    });
  }

  // Check 2: Identifiability
  if (!identifiable) {
    items.push({
      code: CRITIQUE_CODES.IDENTIFIABILITY_ISSUE,
      severity: 'BLOCKER',
      semantic_severity: 'ERROR',
      message: 'Model not identifiable. Causal effects cannot be reliably estimated.',
      suggested_action: 'Add instrumental variables or break confounding paths',
      auto_fixable: false,
      source: 'engine',
    });
  }

  // Check 3: Disconnected nodes
  const connected_nodes = new Set<string>();
  for (const edge of graph.edges) {
    connected_nodes.add(edge.from);
    connected_nodes.add(edge.to);
  }
  const disconnected = graph.nodes.filter(n => !connected_nodes.has(n.id));
  
  if (disconnected.length > 0) {
    items.push({
      code: CRITIQUE_CODES.GRAPH_DISCONNECTED,
      severity: 'IMPROVEMENT',
      semantic_severity: 'WARNING',
      message: `${disconnected.length} disconnected nodes: ${disconnected.map(n => n.label).join(', ')}`,
      suggested_action: 'Connect isolated nodes or remove them',
      auto_fixable: true,
      source: 'engine',
    });
  }

  // Check 4: Weak edges (if weight available)
  const weak_edges = graph.edges.filter(e => e.weight !== undefined && e.weight < 0.1);
  if (weak_edges.length > 0) {
    items.push({
      code: CRITIQUE_CODES.GRAPH_MISSING_EDGES,
      severity: 'OBSERVATION',
      semantic_severity: 'INFO',
      message: `${weak_edges.length} weak edges (weight < 0.1) detected`,
      suggested_action: 'Consider hiding weak edges to simplify visualization',
      auto_fixable: true,
      source: 'engine',
    });
  }

  // Check 5: Missing assumptions
  if (assumptions.length === 0) {
    items.push({
      code: CRITIQUE_CODES.MISSING_BASELINE,
      severity: 'OBSERVATION',
      semantic_severity: 'INFO',
      message: 'No explicit assumptions provided. Using defaults.',
      suggested_action: 'Specify domain assumptions for transparency',
      auto_fixable: false,
      source: 'engine',
    });
  }

  // Check 6: Cycles (for causal graphs)
  const cycles = detectCycles(graph);
  if (cycles.length > 0) {
    items.push({
      code: CRITIQUE_CODES.GRAPH_CYCLE_DETECTED,
      severity: 'BLOCKER',
      semantic_severity: 'ERROR',
      message: `${cycles.length} cycles detected. Causal models must be acyclic.`,
      suggested_action: 'Break cycles by removing feedback edges or adding time indices',
      auto_fixable: false,
      source: 'engine',
    });
  }

  // If no issues, return positive observation
  if (items.length === 0) {
    items.push({
      severity: 'OBSERVATION',
      semantic_severity: 'INFO',
      message: 'Model structure appears sound. No issues detected.',
      suggested_action: undefined,
      auto_fixable: false,
      source: 'engine',
    });
  }

  return items;
}

/**
 * Simple cycle detection using DFS
 */
function detectCycles(graph: Graph): string[][] {
  const adj = new Map<string, string[]>();
  
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }
  
  for (const edge of graph.edges) {
    const neighbors = adj.get(edge.from) || [];
    neighbors.push(edge.to);
    adj.set(edge.from, neighbors);
  }

  const visited = new Set<string>();
  const rec_stack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    visited.add(node);
    rec_stack.add(node);
    path.push(node);

    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        dfs(neighbor, [...path]);
      } else if (rec_stack.has(neighbor)) {
        // Cycle detected
        const cycle_start = path.indexOf(neighbor);
        if (cycle_start >= 0) {
          cycles.push(path.slice(cycle_start));
        }
      }
    }

    rec_stack.delete(node);
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, []);
    }
  }

  return cycles;
}
