/**
 * Path-to-Goal Validation
 *
 * Validates that intervention targets have a directed path to the goal node
 * through edges with exists_probability > 0.
 *
 * Uses BFS for reachability checking with caching for efficiency.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type {
  EngineGraphV3,
  EngineEdgeV3,
  OptionV3,
  ReachabilityResult,
} from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Adjacency list for directed graph traversal.
 */
export type AdjacencyList = Map<string, string[]>;

/**
 * Per-option path validation result.
 */
export interface OptionPathResult {
  optionId: string;
  optionLabel: string;
  hasPath: boolean;
  targetResults: Map<string, ReachabilityResult>;
  blockedReason?: string;
}

// -----------------------------------------------------------------------------
// Adjacency List Building
// -----------------------------------------------------------------------------

/**
 * Build an adjacency list from graph edges.
 *
 * Only includes edges with exists_probability > 0.
 * This is the foundation for BFS reachability checks.
 *
 * @param edges Graph edges
 * @returns Adjacency list (from → [to, to, ...])
 */
export function buildAdjacencyList(edges: EngineEdgeV3[]): AdjacencyList {
  const adjacency: AdjacencyList = new Map();

  for (const edge of edges) {
    // Skip edges with zero existence probability
    if (edge.exists_probability <= 0) {
      continue;
    }

    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from)!.push(edge.to);
  }

  return adjacency;
}

// -----------------------------------------------------------------------------
// Reachability Check
// -----------------------------------------------------------------------------

/**
 * Check if there is a directed path from source to goal.
 *
 * Uses BFS to find any path through edges with exists_probability > 0.
 *
 * @param adjacency Pre-built adjacency list
 * @param sourceNodeId Starting node
 * @param goalNodeId Target node
 * @returns Reachability result with path if found
 */
export function checkPathToGoal(
  adjacency: AdjacencyList,
  sourceNodeId: string,
  goalNodeId: string
): ReachabilityResult {
  // Handle trivial case
  if (sourceNodeId === goalNodeId) {
    return { reachable: true, path: [sourceNodeId] };
  }

  // BFS from source to goal
  // Use index pointer instead of shift() for O(1) dequeue
  const visited = new Set<string>();
  const queue: Array<{ node: string; path: string[] }> = [
    { node: sourceNodeId, path: [sourceNodeId] },
  ];
  let head = 0;

  while (head < queue.length) {
    const { node, path } = queue[head++];

    if (node === goalNodeId) {
      return { reachable: true, path };
    }

    if (visited.has(node)) {
      continue;
    }
    visited.add(node);

    const neighbours = adjacency.get(node) ?? [];
    for (const neighbour of neighbours) {
      if (!visited.has(neighbour)) {
        queue.push({ node: neighbour, path: [...path, neighbour] });
      }
    }
  }

  return {
    reachable: false,
    blocked_reason: `No path from '${sourceNodeId}' to '${goalNodeId}' through edges with exists_probability > 0`,
  };
}

// -----------------------------------------------------------------------------
// Per-Option Validation
// -----------------------------------------------------------------------------

/**
 * Validate that an option has at least one intervention target
 * with a path to the goal.
 *
 * An option is valid if ANY of its intervention targets can reach the goal.
 *
 * @param option Option to validate
 * @param adjacency Pre-built adjacency list
 * @param goalNodeId Target goal node
 * @returns Option path validation result
 */
export function validateOptionPath(
  option: OptionV3,
  adjacency: AdjacencyList,
  goalNodeId: string
): OptionPathResult {
  const targetResults = new Map<string, ReachabilityResult>();
  let hasPath = false;

  // Check each intervention target
  for (const targetNodeId of Object.keys(option.interventions)) {
    const result = checkPathToGoal(adjacency, targetNodeId, goalNodeId);
    targetResults.set(targetNodeId, result);

    if (result.reachable) {
      hasPath = true;
      // Don't break - continue checking all targets for complete diagnostics
    }
  }

  return {
    optionId: option.id,
    optionLabel: option.label,
    hasPath,
    targetResults,
    blockedReason: hasPath
      ? undefined
      : `No intervention target in option '${option.label}' has a path to goal '${goalNodeId}'`,
  };
}

/**
 * Validate all options for path-to-goal connectivity.
 *
 * Each option must independently have at least one intervention target
 * that can reach the goal. If ANY option fails, the entire run should block.
 *
 * @param graph Filtered graph (no option nodes)
 * @param options Options to validate
 * @param goalNodeId Target goal node
 * @returns Map of option ID → path validation result
 */
export function validateOptionPaths(
  graph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string
): Map<string, OptionPathResult> {
  // Build adjacency list once, reuse for all options
  const adjacency = buildAdjacencyList(graph.edges);

  const results = new Map<string, OptionPathResult>();

  for (const option of options) {
    const result = validateOptionPath(option, adjacency, goalNodeId);
    results.set(option.id, result);
  }

  return results;
}

/**
 * Get all intervention targets from options that have no path to goal.
 *
 * Useful for generating detailed error messages.
 *
 * @param pathResults Results from validateOptionPaths
 * @returns Array of { optionLabel, targetNodeId, reason }
 */
export function getBlockedInterventionTargets(
  pathResults: Map<string, OptionPathResult>
): Array<{ optionLabel: string; targetNodeId: string; reason: string }> {
  const blocked: Array<{ optionLabel: string; targetNodeId: string; reason: string }> = [];

  for (const [_optionId, result] of pathResults) {
    if (result.hasPath) {
      continue;
    }

    for (const [targetNodeId, reachability] of result.targetResults) {
      if (!reachability.reachable) {
        blocked.push({
          optionLabel: result.optionLabel,
          targetNodeId,
          reason: reachability.blocked_reason ?? 'No path to goal',
        });
      }
    }
  }

  return blocked;
}

/**
 * Check if all options have at least one path to goal.
 *
 * Quick check without detailed diagnostics.
 *
 * @param pathResults Results from validateOptionPaths
 * @returns True if all options have paths
 */
export function allOptionsHavePaths(
  pathResults: Map<string, OptionPathResult>
): boolean {
  for (const result of pathResults.values()) {
    if (!result.hasPath) {
      return false;
    }
  }
  return true;
}
