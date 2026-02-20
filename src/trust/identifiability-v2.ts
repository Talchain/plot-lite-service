/**
 * V2 Identifiability Assessment (B1.5 / B1.5a)
 *
 * Runs backdoor-criterion identifiability checks for the V2 pipeline.
 * For each (intervention_target, goal_node) pair across all options,
 * tests whether the causal effect is identifiable via the backdoor criterion
 * using the Bayes-ball d-separation algorithm.
 *
 * Design decisions:
 * - Calls findBackdoorAdjustmentSet() and isDSeparated() directly
 *   (bypasses IDENT_DSEP_ENABLE env var gating in computeIdentifiability)
 * - WARNING only, never blocks analysis
 * - Silent degradation on error (returns status: 'unknown')
 * - Results excluded from response hash (non-semantic metadata)
 *
 * B1.5a: Adds boundary mapper (toIdentifiabilityResponse) that converts
 * internal computation result to the contracted IdentifiabilityAssessment shape.
 */

import {
  findBackdoorAdjustmentSet,
  isDSeparated,
  type DAG,
} from './d-separation.js';
import type {
  EngineGraphV3,
  OptionV3,
  IdentifiabilityAssessment,
  IdentifiabilityPairDetail,
} from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Internal Types (computation layer — not exposed on responses)
// -----------------------------------------------------------------------------

export interface InternalPairResult {
  treatment_node_id: string;
  outcome_node_id: string;
  identifiable: boolean;
  /** Confounders: common ancestors of treatment and outcome */
  confounders: string[];
  /** Adjustment set that blocks all backdoor paths */
  adjustment_set: string[];
}

export interface InternalIdentifiabilityResult {
  all_identifiable: boolean;
  pair_count: number;
  non_identifiable_count: number;
  pairs: InternalPairResult[];
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Convert an EngineGraphV3 (post-filter) to the DAG format used by d-separation.
 */
function engineGraphToDAG(graph: EngineGraphV3): DAG {
  return {
    nodes: graph.nodes.map((n) => n.id),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

/**
 * Collect unique intervention target node IDs across all options.
 * Only includes targets that exist in the graph (post-filter).
 */
function collectTreatmentNodes(
  options: OptionV3[],
  graphNodeIds: Set<string>
): string[] {
  const targets = new Set<string>();
  for (const option of options) {
    for (const nodeId of Object.keys(option.interventions)) {
      if (graphNodeIds.has(nodeId)) {
        targets.add(nodeId);
      }
    }
  }
  return [...targets].sort();
}

/**
 * Returns candidate common causes of treatment and outcome via ancestor intersection.
 * This is a heuristic proxy — not a minimal sufficient confounder set.
 * Nodes returned here may appear in the adjustment set (which resolves them)
 * or may be benign common ancestors that don't actually create backdoor paths.
 */
function findConfounders(dag: DAG, treatment: string, outcome: string): string[] {
  const treatmentAncestors = findAllAncestors(dag, treatment);
  const outcomeAncestors = findAllAncestors(dag, outcome);

  const confounders: string[] = [];
  for (const anc of treatmentAncestors) {
    if (outcomeAncestors.has(anc) && anc !== treatment && anc !== outcome) {
      confounders.push(anc);
    }
  }
  return confounders.sort();
}

/**
 * Find all ancestors of a node via reverse BFS.
 */
function findAllAncestors(dag: DAG, node: string): Set<string> {
  const parents = new Map<string, string[]>();
  for (const n of dag.nodes) {
    parents.set(n, []);
  }
  for (const e of dag.edges) {
    parents.get(e.to)?.push(e.from);
  }

  const ancestors = new Set<string>();
  const queue = [...(parents.get(node) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ancestors.has(current)) continue;
    ancestors.add(current);
    for (const p of parents.get(current) ?? []) {
      queue.push(p);
    }
  }
  return ancestors;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Maximum number of detail entries in the response (B1.5a) */
const MAX_DETAILS = 20;

// -----------------------------------------------------------------------------
// Core computation
// -----------------------------------------------------------------------------

/**
 * Assess graph identifiability for the V2 pipeline.
 *
 * @returns InternalIdentifiabilityResult, or undefined on error
 */
export function assessGraphIdentifiability(
  filteredGraph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string
): InternalIdentifiabilityResult | undefined {
  try {
    const dag = engineGraphToDAG(filteredGraph);
    const graphNodeIds = new Set(dag.nodes);

    // Goal node must be in the graph
    if (!graphNodeIds.has(goalNodeId)) {
      return undefined;
    }

    const treatmentNodes = collectTreatmentNodes(options, graphNodeIds);

    // No treatment nodes → no pairs to assess
    if (treatmentNodes.length === 0) {
      return {
        all_identifiable: true,
        pair_count: 0,
        non_identifiable_count: 0,
        pairs: [],
      };
    }

    const pairs: InternalPairResult[] = [];

    for (const treatmentId of treatmentNodes) {
      // Skip self-loops (treatment === outcome)
      if (treatmentId === goalNodeId) continue;

      // Find confounders (common ancestors)
      const confounders = findConfounders(dag, treatmentId, goalNodeId);

      // Find adjustment set using backdoor criterion
      const adjustmentSet = findBackdoorAdjustmentSet(dag, treatmentId, goalNodeId);

      // Build the backdoor DAG (remove outgoing edges from treatment)
      const backdoorDAG: DAG = {
        nodes: dag.nodes,
        edges: dag.edges.filter((e) => e.from !== treatmentId),
      };

      // Test d-separation in the mutilated graph
      const separated = isDSeparated(
        backdoorDAG,
        treatmentId,
        goalNodeId,
        adjustmentSet
      );

      // Identifiable if d-separated OR no adjustment needed (direct effect only)
      const identifiable = separated || adjustmentSet.length === 0;

      pairs.push({
        treatment_node_id: treatmentId,
        outcome_node_id: goalNodeId,
        identifiable,
        confounders,
        adjustment_set: identifiable ? adjustmentSet : [],
      });
    }

    // Sort by (treatment_node_id, outcome_node_id) for determinism
    pairs.sort((a, b) =>
      a.treatment_node_id.localeCompare(b.treatment_node_id) ||
      a.outcome_node_id.localeCompare(b.outcome_node_id)
    );

    const nonIdentifiableCount = pairs.filter((p) => !p.identifiable).length;

    return {
      all_identifiable: nonIdentifiableCount === 0,
      pair_count: pairs.length,
      non_identifiable_count: nonIdentifiableCount,
      pairs,
    };
  } catch {
    // Silent degradation: return undefined on any error
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Boundary mapper (B1.5a)
// -----------------------------------------------------------------------------

/**
 * Map internal identifiability result to contracted response shape.
 *
 * Always returns a valid IdentifiabilityAssessment — never undefined.
 * On undefined input (error) or zero pairs, returns status: 'unknown'.
 */
export function toIdentifiabilityResponse(
  internal: InternalIdentifiabilityResult | undefined
): IdentifiabilityAssessment {
  // Error case or goal-node-missing: unknown
  if (!internal) {
    return { status: 'unknown', method: 'backdoor', pairs_checked: 0, pairs_identifiable: 0 };
  }

  const { pair_count, non_identifiable_count, pairs } = internal;
  const pairsIdentifiable = pair_count - non_identifiable_count;

  // Zero pairs: unknown (nothing to assess)
  if (pair_count === 0) {
    return { status: 'unknown', method: 'backdoor', pairs_checked: 0, pairs_identifiable: 0 };
  }

  // Derive aggregate status
  const status =
    non_identifiable_count === 0
      ? 'identifiable' as const
      : pairsIdentifiable > 0
        ? 'partially_identifiable' as const
        : 'not_backdoor_identifiable' as const;

  const response: IdentifiabilityAssessment = {
    status,
    method: 'backdoor',
    pairs_checked: pair_count,
    pairs_identifiable: pairsIdentifiable,
  };

  // Include details only when at least one pair is not identifiable
  if (non_identifiable_count > 0) {
    // Map internal pairs → contracted detail shape
    let details: IdentifiabilityPairDetail[] = pairs.map((p) => {
      const detail: IdentifiabilityPairDetail = {
        treatment_node_id: p.treatment_node_id,
        outcome_node_id: p.outcome_node_id,
        status: p.identifiable ? 'identifiable' : 'not_backdoor_identifiable',
      };
      if (p.confounders.length > 0) {
        detail.confounders = [...p.confounders].sort();
      }
      if (p.adjustment_set.length > 0) {
        detail.adjustment_set = [...p.adjustment_set].sort();
      }
      return detail;
    });

    // Sort by (treatment_node_id, outcome_node_id) — already sorted from internal, but ensure
    details.sort((a, b) =>
      a.treatment_node_id.localeCompare(b.treatment_node_id) ||
      a.outcome_node_id.localeCompare(b.outcome_node_id)
    );

    // Cap at MAX_DETAILS
    if (details.length > MAX_DETAILS) {
      details = details.slice(0, MAX_DETAILS);
      response.details_truncated = true;
    }

    response.details = details;
  }

  return response;
}
