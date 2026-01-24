/**
 * Preflight Validation for V2 Run Endpoint
 *
 * Comprehensive validation BEFORE calling ISL.
 * All failures return BLOCKER critiques, not fallback analysis.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import { randomUUID } from 'node:crypto';
import {
  NODE_ID_PATTERN,
  MAX_NODES,
  MAX_EDGES,
  MAX_OPTIONS,
} from '../types/engine-v3.js';
import type {
  EngineGraphV3,
  OptionV3,
  CritiqueV3,
  PreflightResultV3,
  BlockerCode,
} from '../types/engine-v3.js';
import {
  validateOptionPaths,
  allOptionsHavePaths,
  getBlockedInterventionTargets,
  buildAdjacencyList,
  checkPathToGoal,
} from './path-to-goal.js';
import {
  checkIdenticalOptions,
  formatIdenticalOptionsMessage,
} from './identical-options.js';

// -----------------------------------------------------------------------------
// Critique Factory
// -----------------------------------------------------------------------------

/**
 * Create a BLOCKER critique.
 */
function createBlocker(
  code: BlockerCode,
  message: string,
  affectedOptionIds?: string[],
  affectedNodeIds?: string[]
): CritiqueV3 {
  return {
    id: randomUUID(),
    code,
    severity: 'blocker',
    message,
    source: 'validation',
    affected_option_ids: affectedOptionIds,
    affected_node_ids: affectedNodeIds,
    blocks_analysis: true,
  };
}

/**
 * Create a warning critique.
 */
function createWarning(
  code: string,
  message: string,
  affectedNodeIds?: string[]
): CritiqueV3 {
  return {
    id: randomUUID(),
    code,
    severity: 'warning',
    message,
    source: 'validation',
    affected_node_ids: affectedNodeIds,
    blocks_analysis: false,
  };
}

// -----------------------------------------------------------------------------
// Individual Validators
// -----------------------------------------------------------------------------

/**
 * Validate goal node exists in graph.
 *
 * Returns MISSING_GOAL_NODE if goal_node_id is empty/undefined.
 * Returns GOAL_NODE_NOT_IN_GRAPH if goal node doesn't exist in graph.
 */
function validateGoalNode(
  graph: EngineGraphV3,
  goalNodeId: string | undefined
): CritiqueV3[] {
  const critiques: CritiqueV3[] = [];

  // Check if goal_node_id is provided
  if (!goalNodeId || goalNodeId.trim() === '') {
    critiques.push(
      createBlocker(
        'MISSING_GOAL_NODE',
        'Goal node is required for option comparison. Please select a goal node.'
      )
    );
    return critiques;
  }

  // Check if goal node exists in graph
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!nodeIds.has(goalNodeId)) {
    critiques.push(
      createBlocker(
        'GOAL_NODE_NOT_IN_GRAPH',
        `Goal node "${goalNodeId}" not found in graph. Select an existing node as the goal, or add the goal node to the graph.`,
        undefined,
        [goalNodeId]
      )
    );
  }

  return critiques;
}

/**
 * Validate options array is present and non-empty.
 */
function validateOptionsPresent(options: OptionV3[] | undefined): CritiqueV3[] {
  if (!options || options.length === 0) {
    return [
      createBlocker(
        'NO_OPTIONS',
        'At least one option is required for comparison.'
      ),
    ];
  }
  return [];
}

/**
 * Validate options count does not exceed limit.
 */
function validateOptionsCount(options: OptionV3[]): CritiqueV3[] {
  if (options.length > MAX_OPTIONS) {
    return [
      createBlocker(
        'TOO_MANY_OPTIONS',
        `Request has ${options.length} options, exceeding the limit of ${MAX_OPTIONS}.`
      ),
    ];
  }
  return [];
}

/**
 * Validate each option has non-empty interventions.
 */
function validateInterventions(
  options: OptionV3[],
  nodeIds: Set<string>
): CritiqueV3[] {
  const critiques: CritiqueV3[] = [];

  for (const option of options) {
    const interventionKeys = Object.keys(option.interventions ?? {});

    // Check for empty interventions
    if (interventionKeys.length === 0) {
      critiques.push(
        createBlocker(
          'EMPTY_INTERVENTIONS',
          `Option '${option.label}' does not specify what it changes. Each option must define at least one intervention.`,
          [option.id]
        )
      );
      continue;
    }

    // Check each intervention target exists in graph
    for (const targetNodeId of interventionKeys) {
      if (!nodeIds.has(targetNodeId)) {
        critiques.push(
          createBlocker(
            'INVALID_INTERVENTION_TARGET',
            `Option '${option.label}' references non-existent node '${targetNodeId}'.`,
            [option.id],
            [targetNodeId]
          )
        );
      }

      // Validate intervention value (separate code for value issues)
      // Normalize flat format { factor_id: 59 } to nested { factor_id: { value: 59 } }
      const rawIntervention = option.interventions[targetNodeId];
      const intervention = typeof rawIntervention === 'number'
        ? { value: rawIntervention }
        : rawIntervention;
      if (
        typeof intervention?.value !== 'number' ||
        !Number.isFinite(intervention.value)
      ) {
        critiques.push(
          createBlocker(
            'INVALID_INTERVENTION_VALUE',
            `Option '${option.label}' has invalid intervention value for node '${targetNodeId}'. Value must be a finite number.`,
            [option.id],
            [targetNodeId]
          )
        );
      }
    }
  }

  return critiques;
}

/**
 * Validate node ID patterns.
 */
function validateNodeIdPatterns(graph: EngineGraphV3): CritiqueV3[] {
  const critiques: CritiqueV3[] = [];

  for (const node of graph.nodes) {
    if (!NODE_ID_PATTERN.test(node.id)) {
      critiques.push(
        createBlocker(
          'INVALID_NODE_ID_PATTERN',
          `Node ID '${node.id}' contains invalid characters. Use only lowercase letters, numbers, underscores, colons, and hyphens.`,
          undefined,
          [node.id]
        )
      );
    }
  }

  return critiques;
}

/**
 * Validate no duplicate node IDs.
 */
function validateNoDuplicateNodeIds(graph: EngineGraphV3): CritiqueV3[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const node of graph.nodes) {
    if (seen.has(node.id)) {
      duplicates.push(node.id);
    }
    seen.add(node.id);
  }

  if (duplicates.length > 0) {
    return [
      createBlocker(
        'DUPLICATE_NODE_IDS',
        `Duplicate node ID(s) found: ${duplicates.join(', ')}.`,
        undefined,
        duplicates
      ),
    ];
  }

  return [];
}

/**
 * Validate edge endpoints exist in graph.
 */
function validateEdgeEndpoints(graph: EngineGraphV3): CritiqueV3[] {
  const critiques: CritiqueV3[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];

    if (!nodeIds.has(edge.from)) {
      critiques.push(
        createBlocker(
          'INVALID_EDGE_ENDPOINT',
          `Edge ${i} references non-existent source node '${edge.from}'.`,
          undefined,
          [edge.from]
        )
      );
    }

    if (!nodeIds.has(edge.to)) {
      critiques.push(
        createBlocker(
          'INVALID_EDGE_ENDPOINT',
          `Edge ${i} references non-existent target node '${edge.to}'.`,
          undefined,
          [edge.to]
        )
      );
    }
  }

  return critiques;
}

/**
 * Validate graph size limits.
 */
function validateGraphSize(graph: EngineGraphV3): CritiqueV3[] {
  const critiques: CritiqueV3[] = [];

  if (graph.nodes.length > MAX_NODES) {
    critiques.push(
      createBlocker(
        'GRAPH_TOO_LARGE',
        `Graph has ${graph.nodes.length} nodes, exceeding the limit of ${MAX_NODES}.`
      )
    );
  }

  if (graph.edges.length > MAX_EDGES) {
    critiques.push(
      createBlocker(
        'GRAPH_TOO_LARGE',
        `Graph has ${graph.edges.length} edges, exceeding the limit of ${MAX_EDGES}.`
      )
    );
  }

  return critiques;
}

/**
 * Detect cycles in the graph using DFS.
 */
function detectCycles(graph: EngineGraphV3): string[][] {
  const adjacency = buildAdjacencyList(graph.edges);
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (recursionStack.has(node)) {
      // Found a cycle - extract it from the path
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(path.slice(cycleStart).concat(node));
      }
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbours = adjacency.get(node) ?? [];
    for (const neighbour of neighbours) {
      dfs(neighbour);
    }

    path.pop();
    recursionStack.delete(node);
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return cycles;
}

/**
 * Check for cycles in graph.
 * V2: Cycles are blockers - causal graphs must be DAGs for valid inference.
 */
function checkCycles(graph: EngineGraphV3): CritiqueV3[] {
  const cycles = detectCycles(graph);

  if (cycles.length > 0) {
    // V2: Cycles are blockers - causal inference requires acyclic graphs
    return [
      createBlocker(
        'GRAPH_CYCLE_DETECTED',
        `${cycles.length} cycle(s) detected. Causal graphs must be acyclic (DAG) for valid inference.`
      ),
    ];
  }

  return [];
}

/**
 * Validate options are not identical.
 */
function validateNotIdenticalOptions(options: OptionV3[]): CritiqueV3[] {
  const result = checkIdenticalOptions(options);

  if (result.hasDuplicates) {
    const message = formatIdenticalOptionsMessage(result.duplicatePairs);
    const affectedIds = result.duplicatePairs.flatMap(([, label]) =>
      options.filter((o) => o.label === label).map((o) => o.id)
    );

    return [createBlocker('IDENTICAL_OPTIONS', message, affectedIds)];
  }

  return [];
}

/**
 * Validate paths from intervention targets to goal.
 */
function validatePathsToGoal(
  graph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string
): CritiqueV3[] {
  const pathResults = validateOptionPaths(graph, options, goalNodeId);

  if (allOptionsHavePaths(pathResults)) {
    return [];
  }

  // Generate critiques for options without paths
  const critiques: CritiqueV3[] = [];
  const blockedTargets = getBlockedInterventionTargets(pathResults);

  for (const result of pathResults.values()) {
    if (!result.hasPath) {
      critiques.push(
        createBlocker(
          'NO_PATH_TO_GOAL',
          `Option '${result.optionLabel}' has no causal effect on the goal. Interventions must affect variables connected to the goal.`,
          [result.optionId]
        )
      );
    }
  }

  return critiques;
}

// -----------------------------------------------------------------------------
// Scale Mismatch Validation
// -----------------------------------------------------------------------------

/** Threshold ratio above which we emit a scale mismatch warning */
const SCALE_MISMATCH_THRESHOLD = 100;

/**
 * Validate intervention values don't span excessive ranges.
 *
 * Per Data Responsibility Contract §10.4: PLoT should warn, not silently repair.
 * When intervention values span wide ranges (e.g., binary 0/1 alongside $180,000),
 * Monte Carlo simulation may produce misleading outcomes.
 *
 * @param options Options with interventions
 * @returns Warning critique if scale mismatch detected, empty array otherwise
 */
function validateInterventionScales(options: OptionV3[]): CritiqueV3[] {
  // Collect all numeric intervention values across all options
  const allValues: number[] = [];

  for (const option of options) {
    for (const [, rawIntervention] of Object.entries(option.interventions ?? {})) {
      // Normalize flat format { factor_id: 59 } to nested { factor_id: { value: 59 } }
      const intervention =
        typeof rawIntervention === 'number'
          ? { value: rawIntervention }
          : rawIntervention;

      if (typeof intervention?.value === 'number' && Number.isFinite(intervention.value)) {
        allValues.push(intervention.value);
      }
    }
  }

  // Filter to non-zero values (zeros are excluded from scale comparison)
  const nonZeroValues = allValues.filter((v) => v !== 0);

  // Need at least 2 non-zero values to compute a ratio
  if (nonZeroValues.length < 2) {
    return [];
  }

  // Calculate ratio: max(|values|) / min(|non-zero values|)
  const absValues = nonZeroValues.map(Math.abs);
  const maxAbs = Math.max(...absValues);
  const minAbs = Math.min(...absValues);

  // Guard against division by zero (shouldn't happen after filtering, but defensive)
  if (minAbs === 0) {
    return [];
  }

  const ratio = maxAbs / minAbs;

  if (ratio > SCALE_MISMATCH_THRESHOLD) {
    // Format ratio for display (round to nearest integer for readability)
    const displayRatio = Math.round(ratio).toLocaleString();

    return [
      {
        id: randomUUID(),
        code: 'SCALE_MISMATCH_WARNING',
        severity: 'warning',
        message: `Intervention values span wide range (max is ~${displayRatio}× min). Large magnitudes may dominate outcomes.`,
        suggestion:
          'Express large quantities as 0–1 proportions with explicit cap in factor label.',
        source: 'validation',
        blocks_analysis: false,
      },
    ];
  }

  return [];
}

// -----------------------------------------------------------------------------
// Main Preflight Validation
// -----------------------------------------------------------------------------

/**
 * Run all preflight validations.
 *
 * This is the main entry point for V2 preflight validation.
 * All blockers are collected before returning.
 *
 * @param graph Normalized and filtered graph
 * @param options Options array from request
 * @param goalNodeId Goal node ID from request
 * @param stats Stats for logging
 * @returns Preflight result with pass/fail and all critiques
 */
export function runPreflightValidation(
  graph: EngineGraphV3,
  options: OptionV3[] | undefined,
  goalNodeId: string | undefined,
  stats: {
    optionNodesFiltered: number;
    optionEdgesFiltered: number;
    nodesNormalised: number;
    edgesNormalised: number;
  }
): PreflightResultV3 {
  const blockers: CritiqueV3[] = [];
  const warnings: CritiqueV3[] = [];

  // Node set for validation
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  // Run structural validations first (these don't depend on options)
  blockers.push(...validateNodeIdPatterns(graph));
  blockers.push(...validateNoDuplicateNodeIds(graph));
  blockers.push(...validateEdgeEndpoints(graph));
  blockers.push(...validateGraphSize(graph));
  blockers.push(...checkCycles(graph)); // V2: cycles are blockers

  // Validate goal node
  const goalCritiques = validateGoalNode(graph, goalNodeId);
  blockers.push(...goalCritiques);
  const goalExists = goalCritiques.length === 0 && goalNodeId !== undefined;

  // Validate options presence
  const optionsCritiques = validateOptionsPresent(options);
  blockers.push(...optionsCritiques);

  // Only continue with option-specific validation if options exist
  let optionsWithInterventions = 0;
  let optionsWithPathToGoal = 0;
  let interventionTargets: string[] = [];
  let targetsWithPathToGoalCount = 0;

  if (options && options.length > 0) {
    // Validate options count
    blockers.push(...validateOptionsCount(options));

    // Validate interventions
    blockers.push(...validateInterventions(options, nodeIds));

    // Check for scale mismatch in intervention values (warning only)
    warnings.push(...validateInterventionScales(options));

    // Count options with interventions
    optionsWithInterventions = options.filter(
      (o) => Object.keys(o.interventions ?? {}).length > 0
    ).length;

    // Collect intervention targets
    interventionTargets = [
      ...new Set(options.flatMap((o) => Object.keys(o.interventions ?? {}))),
    ];

    // Validate identical options
    blockers.push(...validateNotIdenticalOptions(options));

    // Validate paths to goal (only if goal exists and no prior blockers)
    if (goalExists && blockers.length === 0) {
      const pathCritiques = validatePathsToGoal(graph, options, goalNodeId!);
      blockers.push(...pathCritiques);

      // Count options with paths
      const pathResults = validateOptionPaths(graph, options, goalNodeId!);
      optionsWithPathToGoal = [...pathResults.values()].filter(
        (r) => r.hasPath
      ).length;

      // Count targets with paths
      const adjacency = buildAdjacencyList(graph.edges);
      targetsWithPathToGoalCount = interventionTargets.filter((target) => {
        return checkPathToGoal(adjacency, target, goalNodeId!).reachable;
      }).length;
    }
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,

    // Stats for logging
    goal_node_exists: goalExists,
    options_count: options?.length ?? 0,
    options_with_interventions: optionsWithInterventions,
    options_with_path_to_goal: optionsWithPathToGoal,
    intervention_targets: interventionTargets,
    targets_with_path_to_goal_count: targetsWithPathToGoalCount,
    option_nodes_filtered: stats.optionNodesFiltered,
    option_edges_filtered: stats.optionEdgesFiltered,
    edges_normalised: stats.edgesNormalised,
    nodes_normalised: stats.nodesNormalised,
  };
}

/**
 * Quick check if preflight would pass.
 *
 * Useful for early exit without full validation.
 */
export function wouldPreflightPass(
  graph: EngineGraphV3,
  options: OptionV3[] | undefined,
  goalNodeId: string | undefined
): boolean {
  // Quick structural checks
  if (!goalNodeId || goalNodeId.trim() === '') return false;
  if (!options || options.length === 0) return false;

  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  if (!nodeIds.has(goalNodeId)) return false;

  // Check all options have interventions
  for (const option of options) {
    if (Object.keys(option.interventions ?? {}).length === 0) {
      return false;
    }
  }

  return true;
}
