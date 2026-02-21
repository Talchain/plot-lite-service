/**
 * V2 Identifiability Assessment (B1.5 / B1.5a / 3A-trust)
 *
 * Runs backdoor-criterion identifiability checks for the V2 pipeline.
 * For each (intervention_target, goal_node) pair across all options,
 * tests whether the causal effect is identifiable via the backdoor criterion
 * using the Bayes-ball d-separation algorithm.
 *
 * 3A-trust: Bidirected edges (edge_type === 'bidirected') represent unmeasured
 * common causes. For identifiability checking, each bidirected edge A↔B is
 * internally expanded into an unobserved latent node with directed edges to
 * both endpoints. Latent nodes are excluded from the adjustment set.
 *
 * Design decisions:
 * - Calls findBackdoorAdjustmentSet() and isDSeparated() directly
 *   (bypasses IDENT_DSEP_ENABLE env var gating in computeIdentifiability)
 * - WARNING only, never blocks analysis
 * - Silent degradation on error (returns status: 'unknown')
 * - Results included in response hash (v4+) — deterministic function of graph structure
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

/** Reserved prefix for latent nodes created during bidirected edge expansion. */
const LATENT_PREFIX = '__latent__';

/**
 * Convert an EngineGraphV3 (post-filter) to the DAG format used by d-separation.
 * Excludes bidirected edges — those are handled separately via latent expansion.
 */
function engineGraphToDAG(graph: EngineGraphV3): DAG {
  return {
    nodes: graph.nodes.map((n) => n.id),
    edges: graph.edges
      .filter((e) => e.edge_type !== 'bidirected')
      .map((e) => ({ from: e.from, to: e.to })),
  };
}

/**
 * Expand bidirected edges into latent nodes with directed edges.
 *
 * Each bidirected edge A↔B becomes:
 *   latent_node → A
 *   latent_node → B
 *
 * Latent node ID: `__latent__${sorted_endpoints}` for determinism.
 * Duplicate bidirected edges between the same pair produce a single latent node.
 *
 * @returns Set of latent node IDs that were added (empty if no bidirected edges)
 */
function expandBidirectedEdges(dag: DAG, graph: EngineGraphV3): Set<string> {
  const latentNodeIds = new Set<string>();
  const bidirectedEdges = graph.edges.filter((e) => e.edge_type === 'bidirected');

  for (const be of bidirectedEdges) {
    const latentId = `${LATENT_PREFIX}${[be.from, be.to].sort().join('_')}`;
    if (!latentNodeIds.has(latentId)) {
      latentNodeIds.add(latentId);
      dag.nodes.push(latentId);
      dag.edges.push({ from: latentId, to: be.from });
      dag.edges.push({ from: latentId, to: be.to });
    }
  }

  return latentNodeIds;
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
 * Bidirected edges are internally expanded into latent nodes for
 * identifiability checking. The latent nodes are never exposed in output.
 *
 * **Precondition:** Callers should pre-filter the graph with
 * `filterInvalidBidirectedEdges()` so that only valid bidirected edges
 * (factor↔factor) reach this function. This function expands ALL
 * bidirected edges it receives without node-kind validation.
 *
 * @returns InternalIdentifiabilityResult, or undefined on error
 */
export function assessGraphIdentifiability(
  filteredGraph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string
): InternalIdentifiabilityResult | undefined {
  try {
    // Guard: no real node may use the reserved latent prefix
    for (const n of filteredGraph.nodes) {
      if (n.id.startsWith(LATENT_PREFIX)) {
        throw new Error(`Node ID '${n.id}' uses reserved prefix '${LATENT_PREFIX}'`);
      }
    }

    const dag = engineGraphToDAG(filteredGraph);
    const graphNodeIds = new Set(dag.nodes);

    // Goal node must be in the graph
    if (!graphNodeIds.has(goalNodeId)) {
      return undefined;
    }

    // 3A-trust: Expand bidirected edges into latent nodes
    const latentNodeIds = expandBidirectedEdges(dag, filteredGraph);

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

      // Find confounders (common ancestors) — latent nodes may appear, strip later
      const confounders = findConfounders(dag, treatmentId, goalNodeId);

      // Find adjustment set using backdoor criterion
      // Latent nodes are excluded from candidates via excludeFromAdjustment
      const adjustmentSet = findBackdoorAdjustmentSet(
        dag, treatmentId, goalNodeId, latentNodeIds.size > 0 ? latentNodeIds : undefined
      );

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

      // Identifiable if d-separated given the adjustment set.
      // When no latent nodes exist, an empty adjustment set means no confounding
      // (direct effect only) — identifiable. When latent nodes exist, an empty
      // adjustment set means no observed variable can block the backdoor path
      // through the latent — must verify via d-separation.
      const identifiable = latentNodeIds.size > 0
        ? separated
        : separated || adjustmentSet.length === 0;

      pairs.push({
        treatment_node_id: treatmentId,
        outcome_node_id: goalNodeId,
        identifiable,
        // Strip latent node references from output
        confounders: confounders.filter((c) => !c.startsWith(LATENT_PREFIX)),
        adjustment_set: identifiable
          ? adjustmentSet.filter((a) => !a.startsWith(LATENT_PREFIX))
          : [],
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

/**
 * Detect how many treatment-outcome pairs became non-identifiable specifically
 * because of bidirected edges (unmeasured confounding).
 *
 * Compares identifiability with bidirected expansion vs without.
 * Only called when the graph has bidirected edges AND some pairs are non-identifiable.
 *
 * @returns Number of affected pairs (0 if bidirected edges didn't cause failures)
 */
export function detectUnmeasuredConfounding(
  withBidirected: InternalIdentifiabilityResult,
  graph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string
): number {
  // Run identifiability on directed-only graph (no bidirected expansion)
  const directedOnlyGraph: EngineGraphV3 = {
    nodes: graph.nodes,
    edges: graph.edges.filter((e) => e.edge_type !== 'bidirected'),
  };
  const withoutBidirected = assessGraphIdentifiability(directedOnlyGraph, options, goalNodeId);

  if (!withoutBidirected) return 0;

  // Count pairs identifiable without bidirected but not with them
  let affectedCount = 0;
  for (const pairWithout of withoutBidirected.pairs) {
    if (!pairWithout.identifiable) continue;
    const pairWith = withBidirected.pairs.find(
      (p) => p.treatment_node_id === pairWithout.treatment_node_id
        && p.outcome_node_id === pairWithout.outcome_node_id
    );
    if (pairWith && !pairWith.identifiable) {
      affectedCount++;
    }
  }

  return affectedCount;
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
