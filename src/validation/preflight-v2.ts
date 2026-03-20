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
  EngineNodeV3,
  EngineEdgeV3,
  OptionV3,
  CritiqueV3,
  PreflightResultV3,
  BlockerCode,
  GoalConstraint,
} from '../types/engine-v3.js';
import {
  validateOptionPaths,
  allOptionsHavePaths,
  getBlockedInterventionTargets,
  buildAdjacencyList,
  checkPathToGoal,
} from './path-to-goal.js';
import {
  deduplicateOptions,
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

/**
 * Create an info critique (not displayed in the UI results panel).
 */
function createInfo(
  code: string,
  message: string,
  affectedNodeIds?: string[]
): CritiqueV3 {
  return {
    id: randomUUID(),
    code,
    severity: 'info',
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
 * Deduplicate identical options.
 *
 * When duplicates exist but >= 2 unique options remain, emits warnings
 * and returns the deduplicated set. Only blocks when < 2 unique options
 * remain after dedup.
 */
function validateNotIdenticalOptions(
  options: OptionV3[]
): { blockers: CritiqueV3[]; warnings: CritiqueV3[]; deduplicated?: OptionV3[] } {
  const { uniqueOptions, dropped } = deduplicateOptions(options);

  // No duplicates → pass cleanly
  if (dropped.length === 0) {
    return { blockers: [], warnings: [] };
  }

  // Build per-dropped-option warnings (used in both branches)
  const dedupWarnings: CritiqueV3[] = dropped.map(({ droppedOption, keptOption }) => ({
    id: randomUUID(),
    code: 'IDENTICAL_OPTIONS_DEDUPED',
    severity: 'warning' as const,
    message: `Option '${droppedOption.label}' has identical interventions to '${keptOption.label}' and was removed. Analysis proceeds with deduplicated options.`,
    source: 'validation' as const,
    affected_option_ids: [keptOption.id, droppedOption.id],
    blocks_analysis: false,
  }));

  // Block if fewer than 2 unique options remain after dedup
  if (uniqueOptions.length < 2) {
    const message = formatIdenticalOptionsMessage(
      dropped.map(d => [d.keptOption.label, d.droppedOption.label])
    );
    return {
      blockers: [createBlocker('IDENTICAL_OPTIONS', message,
        dropped.map(d => d.droppedOption.id))],
      warnings: dedupWarnings,
    };
  }

  return { blockers: [], warnings: dedupWarnings, deduplicated: uniqueOptions };
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
          [result.optionId],
          [goalNodeId]
        )
      );
    }
  }

  return critiques;
}

// -----------------------------------------------------------------------------
// Goal Constraint Validation
// -----------------------------------------------------------------------------

/**
 * Node kinds that are excluded from inference.
 * Constraints cannot target these node types.
 */
const INFERENCE_EXCLUDED_KINDS = ['decision', 'option', 'constraint'] as const;

/**
 * Valid constraint operators (ASCII only).
 */
const VALID_OPERATORS = ['>=', '<='] as const;

/**
 * Validation result for goal constraints.
 */
export interface ConstraintValidationResult {
  blockers: CritiqueV3[];
  warnings: CritiqueV3[];
}

/**
 * Validate goal constraints if present.
 *
 * Only runs if `goal_constraints` is present and non-empty.
 * Emits blocker critiques for:
 * - CONSTRAINT_TARGET_NOT_FOUND: node_id not in graph.nodes
 * - CONSTRAINT_TARGET_NOT_IN_INFERENCE: target node kind is decision/option/constraint
 * - CONSTRAINT_INVALID_OPERATOR: operator not >= or <=
 * - CONSTRAINT_DUPLICATE_ID: two constraints share the same constraint_id
 *
 * Emits warning critiques for:
 * - CONSTRAINT_VALUE_OUTSIDE_RANGE: value outside derivable state_space.range
 * - CONSTRAINT_MISSING_RANGE: target node has no derivable range
 * - CONSTRAINT_DUPLICATE_TARGET: two constraints target same node with same operator
 * - CONSTRAINT_TARGET_NO_OBSERVED_VALUE: factor node has no observed_state.value (ISL defaults to intercept=0)
 *
 * @param goalConstraints Goal constraints from request (may be undefined or empty)
 * @param graph Normalized graph
 * @returns Validation result with blockers and warnings
 */
export function validateGoalConstraints(
  goalConstraints: GoalConstraint[] | undefined,
  graph: EngineGraphV3
): ConstraintValidationResult {
  const blockers: CritiqueV3[] = [];
  const warnings: CritiqueV3[] = [];

  // Only validate if goal_constraints is present and non-empty
  if (!goalConstraints || goalConstraints.length === 0) {
    return { blockers, warnings };
  }

  // Build node lookup maps
  const nodeMap = new Map<string, EngineNodeV3>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  // Track constraint_ids for duplicate detection
  const seenConstraintIds = new Set<string>();

  // Track (node_id, operator) pairs for duplicate target detection
  const seenTargets = new Map<string, GoalConstraint>();

  for (const constraint of goalConstraints) {
    const { constraint_id, node_id, operator, value } = constraint;

    // Check for duplicate constraint_id (blocker)
    if (seenConstraintIds.has(constraint_id)) {
      blockers.push(
        createBlocker(
          'CONSTRAINT_DUPLICATE_ID',
          `Duplicate constraint_id "${constraint_id}". Each constraint must have a unique ID.`,
          undefined,
          [node_id]
        )
      );
      continue; // Skip further validation for this constraint
    }
    seenConstraintIds.add(constraint_id);

    // Check node exists in graph (blocker)
    const targetNode = nodeMap.get(node_id);
    if (!targetNode) {
      blockers.push(
        createBlocker(
          'CONSTRAINT_TARGET_NOT_FOUND',
          `Constraint "${constraint_id}" targets node "${node_id}" which does not exist in the graph.`,
          undefined,
          [node_id]
        )
      );
      continue; // Skip further validation for this constraint
    }

    // Check node kind is not excluded from inference (blocker)
    if (INFERENCE_EXCLUDED_KINDS.includes(targetNode.kind as any)) {
      blockers.push(
        createBlocker(
          'CONSTRAINT_TARGET_NOT_IN_INFERENCE',
          `Constraint "${constraint_id}" targets node "${node_id}" with kind "${targetNode.kind}". Constraints can only target nodes that participate in inference (not decision, option, or constraint nodes).`,
          undefined,
          [node_id]
        )
      );
      continue; // Skip further validation for this constraint
    }

    // Check operator is valid (blocker)
    if (!VALID_OPERATORS.includes(operator as any)) {
      blockers.push(
        createBlocker(
          'CONSTRAINT_INVALID_OPERATOR',
          `Constraint "${constraint_id}" has invalid operator "${operator}". Use ">=" or "<=".`,
          undefined,
          [node_id]
        )
      );
      continue; // Skip further validation for this constraint
    }

    // Check for factor nodes without observed_state.value - warning
    // When ISL receives a factor node without observed_state, it defaults to
    // intercept=0. Constraints against such nodes produce misleading P values
    // (e.g., P(0 <= 0.04) = 1.0 trivially).
    if (targetNode.kind === 'factor' && targetNode.observed_state?.value === undefined) {
      warnings.push(
        createWarning(
          'CONSTRAINT_TARGET_NO_OBSERVED_VALUE',
          `Constraint "${constraint_id}" targets factor node "${node_id}" which has no observed_state.value. ISL will default to intercept=0, which may produce misleading probability results.`,
          [node_id]
        )
      );
    }

    // Check for duplicate target (node_id, operator) - warning
    const targetKey = `${node_id}:${operator}`;
    const existingConstraint = seenTargets.get(targetKey);
    if (existingConstraint) {
      // Determine which constraint is kept (strictest threshold)
      const keepExisting = (operator === '>=' && existingConstraint.value >= value) ||
                          (operator === '<=' && existingConstraint.value <= value);
      const keptId = keepExisting ? existingConstraint.constraint_id : constraint_id;
      const droppedId = keepExisting ? constraint_id : existingConstraint.constraint_id;

      warnings.push(
        createWarning(
          'CONSTRAINT_DUPLICATE_TARGET',
          `Constraints "${existingConstraint.constraint_id}" and "${constraint_id}" both target node "${node_id}" with operator "${operator}". Keeping "${keptId}" (stricter threshold), dropping "${droppedId}".`,
          [node_id]
        )
      );

      // Update seenTargets if the new constraint is stricter
      if (!keepExisting) {
        seenTargets.set(targetKey, constraint);
      }
    } else {
      seenTargets.set(targetKey, constraint);
    }

    // Check value against derivable range - warning only
    const stateSpace = targetNode.state_space;
    const range = stateSpace?.range;

    if (range && typeof range.min === 'number' && typeof range.max === 'number') {
      // Range is derivable - check if value is within range
      if (value < range.min || value > range.max) {
        warnings.push(
          createWarning(
            'CONSTRAINT_VALUE_OUTSIDE_RANGE',
            `Constraint "${constraint_id}" value ${value} is outside the derivable range [${range.min}, ${range.max}] for node "${node_id}".`,
            [node_id]
          )
        );
      }
    } else {
      // Range is not derivable - informational only (no downstream impact
      // since constraint values pass through raw to ISL)
      warnings.push(
        createInfo(
          'CONSTRAINT_MISSING_RANGE',
          `Constraint "${constraint_id}" target node "${node_id}" has no derivable range. Constraint value will be compared as-is by ISL.`,
          [node_id]
        )
      );
    }
  }

  return { blockers, warnings };
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

/**
 * Validate bidirected edges connect only factor-kind nodes.
 *
 * Unmeasured confounding (bidirected edges) is only meaningful between factor
 * nodes. Bidirected edges involving goals, outcomes, risks, actions, or other
 * non-factor kinds are semantically invalid and should be excluded from
 * identifiability analysis.
 *
 * Returns INVALID_BIDIRECTED_EDGE warnings for each invalid edge. The edges
 * remain in the response graph but are skipped for identifiability computation.
 */
function validateBidirectedEdgeKinds(graph: EngineGraphV3): CritiqueV3[] {
  const nodeKindMap = new Map<string, string>();
  const nodeLabelMap = new Map<string, string>();
  for (const n of graph.nodes) {
    nodeKindMap.set(n.id, n.kind);
    nodeLabelMap.set(n.id, n.label || n.id);
  }

  const warnings: CritiqueV3[] = [];

  for (const edge of graph.edges) {
    if (edge.edge_type !== 'bidirected') continue;

    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    // Both endpoints must be factor-kind for valid bidirected edges
    if (fromKind !== 'factor' || toKind !== 'factor') {
      const fromLabel = nodeLabelMap.get(edge.from) ?? edge.from;
      const toLabel = nodeLabelMap.get(edge.to) ?? edge.to;
      warnings.push(createWarning(
        'INVALID_BIDIRECTED_EDGE',
        `Bidirected edge between ${fromLabel} and ${toLabel} is invalid — unmeasured confounding is only meaningful between factor nodes. This edge will be ignored for identifiability analysis.`,
        [edge.from, edge.to]
      ));
    }
  }

  return warnings;
}

/**
 * Return true when a bidirected edge is valid for identifiability analysis
 * (both endpoints are factor-kind nodes).
 */
function isValidBidirectedEdge(
  edge: EngineEdgeV3,
  nodeKindMap: Map<string, string>
): boolean {
  if (edge.edge_type !== 'bidirected') return true; // directed edges always pass
  return nodeKindMap.get(edge.from) === 'factor' && nodeKindMap.get(edge.to) === 'factor';
}

/**
 * Filter out bidirected edges with non-factor endpoints.
 *
 * Returns a graph copy where invalid bidirected edges are removed. Directed
 * edges and valid bidirected edges (factor↔factor) are preserved.
 *
 * Use this before passing a graph to identifiability analysis so that
 * nonsensical bidirected edges (e.g., factor↔goal) don't trigger latent
 * expansion or confounding warnings.
 */
export function filterInvalidBidirectedEdges(graph: EngineGraphV3): EngineGraphV3 {
  const nodeKindMap = new Map<string, string>();
  for (const n of graph.nodes) {
    nodeKindMap.set(n.id, n.kind);
  }

  const hasBadBidirected = graph.edges.some(
    (e) => e.edge_type === 'bidirected' && !isValidBidirectedEdge(e, nodeKindMap)
  );

  // Fast path: no invalid bidirected edges → return original (no copy)
  if (!hasBadBidirected) return graph;

  return {
    nodes: graph.nodes,
    edges: graph.edges.filter((e) => isValidBidirectedEdge(e, nodeKindMap)),
  };
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

  // 3A-trust: Validate bidirected edges connect only factor-kind nodes
  warnings.push(...validateBidirectedEdgeKinds(graph));

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
  let deduplicatedOptions: OptionV3[] | undefined;

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

    // Deduplicate identical options (warning + dedup, block only if < 2 unique)
    const identicalResult = validateNotIdenticalOptions(options);
    blockers.push(...identicalResult.blockers);
    warnings.push(...identicalResult.warnings);
    deduplicatedOptions = identicalResult.deduplicated;

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
    deduplicated_options: deduplicatedOptions,

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

// -----------------------------------------------------------------------------
// Post-Normalization Validation
// -----------------------------------------------------------------------------

/**
 * Validate that effective inbound causal influence does not exceed 1.0
 * for nodes with known bounded ranges.
 *
 * Effective influence per edge = |strength.mean| × exists_probability.
 * This accounts for uncertain edges contributing less influence than certain ones.
 *
 * Only checks nodes with explicit scale bounds (state_space.range set),
 * not all inference-participating nodes, to avoid scientific false alarms
 * on nodes whose values have no known bounded range.
 *
 * Structural edges (decision→option, option→factor) and bidirected edges
 * are excluded from the sum.
 *
 * Must be called AFTER graph normalization on the filtered graph (non-causal
 * nodes already removed, edges have canonical strength values).
 *
 * @param graph Normalized, filtered graph (post-normaliseGraphWithRepairs + filterOptionNodes)
 * @returns Warning critiques for bounded nodes with excessive inbound influence
 */
export function validateInboundStrengthSum(graph: EngineGraphV3): CritiqueV3[] {
  const nodeKindMap = new Map<string, string>();
  const nodeLabelMap = new Map<string, string>();
  for (const n of graph.nodes) {
    nodeKindMap.set(n.id, n.kind);
    nodeLabelMap.set(n.id, n.label || n.id);
  }

  const warnings: CritiqueV3[] = [];

  for (const node of graph.nodes) {
    // Only check nodes with explicit bounded range (state_space.range)
    const range = node.state_space?.range;
    if (!range || typeof range.min !== 'number' || typeof range.max !== 'number') continue;

    const inboundEdges: Array<{ from: string; effective: number }> = [];
    let sum = 0;

    for (const edge of graph.edges) {
      if (edge.to !== node.id) continue;

      // Skip structural edges (decision→option, option→factor)
      const fromKind = nodeKindMap.get(edge.from);
      if (fromKind === 'decision' || fromKind === 'option') continue;

      // Skip bidirected edges (confounders, not causal influence)
      if (edge.edge_type === 'bidirected') continue;

      const absMean = Math.abs(edge.strength?.mean ?? 0);
      const existsProb = edge.exists_probability ?? 1.0;
      const effective = absMean * existsProb;
      if (effective > 0) {
        inboundEdges.push({ from: edge.from, effective });
        sum += effective;
      }
    }

    if (sum > 1.0) {
      // Sort by effective influence descending for stable output
      const sorted = inboundEdges.sort((a, b) => b.effective - a.effective);
      const edgeDescs = sorted
        .map((e) => `${nodeLabelMap.get(e.from) ?? e.from} (${e.effective.toFixed(2)})`)
        .join(', ');

      warnings.push({
        id: randomUUID(),
        code: 'INBOUND_STRENGTH_SUM_EXCEEDED',
        severity: 'warning',
        message: `"${nodeLabelMap.get(node.id) ?? node.id}" has effective inbound influence of ${sum.toFixed(2)} (exceeds 1.0). Contributors: ${edgeDescs}.`,
        source: 'validation',
        affected_node_ids: [node.id],
        blocks_analysis: false,
      });
    }
  }

  // Sort by node ID for deterministic output order
  warnings.sort((a, b) => (a.affected_node_ids?.[0] ?? '').localeCompare(b.affected_node_ids?.[0] ?? ''));

  return warnings;
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
