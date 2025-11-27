/**
 * Identifiability Helper
 * Returns "Identifiable: Yes/No" plus adjustment set in one sentence
 */

import type { Graph } from './types.js';
import {
  validateDAG,
  validateNodesExist,
  computeIdentifiability as computeIdentifiabilityDSep,
  type DAG,
  type DAGValidationResult,
} from './d-separation.js';

export interface AdjustmentSetMetadata {
  /** Variables in the adjustment set */
  variables: string[];
  /** Labels of variables (when available) */
  labels: string[];
  /** Whether adjustment blocks all backdoor paths */
  blocks_backdoor_paths: boolean;
  /** Whether adjustment set was verified via d-separation */
  d_separation_verified: boolean;
  /** Criterion used: 'backdoor' | 'frontdoor' | 'none' */
  criterion: 'backdoor' | 'frontdoor' | 'none';
}

export interface IdentifiabilityResult {
  identifiable: boolean;
  summary: string;
  adjustment_set: string[];
  notes: string[];
  reason?: string;
  /** Detailed metadata about the adjustment set */
  adjustment_metadata?: AdjustmentSetMetadata;
  /** DAG validation results (when validation is enabled) */
  dag_validation?: DAGValidationResult;
}

export interface IdentifiabilityInputs {
  graph: Graph;
  treatment_node: string;
  outcome_node: string;
}

/**
 * Convert Graph to DAG format for d-separation functions
 */
function graphToDAG(graph: Graph): DAG {
  return {
    nodes: graph.nodes.map((n) => n.id),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

/**
 * Check identifiability and suggest adjustment set
 * Uses d-separation when IDENT_DSEP_ENABLE=1
 */
export function checkIdentifiability(inputs: IdentifiabilityInputs): IdentifiabilityResult {
  const { graph, treatment_node, outcome_node } = inputs;

  // Convert to DAG format for validation
  const dag = graphToDAG(graph);

  // Validate DAG structure (optional, controlled by env var)
  let dagValidation: DAGValidationResult | undefined;
  if (process.env.IDENT_DAG_VALIDATE === '1') {
    dagValidation = validateDAG(dag);
    if (!dagValidation.valid) {
      return {
        identifiable: false,
        summary: 'Identifiable: No',
        adjustment_set: [],
        notes: dagValidation.issues,
        reason: 'invalid_dag',
        dag_validation: dagValidation,
      };
    }
  }

  // Build adjacency map
  const parents = new Map<string, Set<string>>();
  const children = new Map<string, Set<string>>();

  for (const node of graph.nodes) {
    parents.set(node.id, new Set());
    children.set(node.id, new Set());
  }

  for (const edge of graph.edges) {
    children.get(edge.from)?.add(edge.to);
    parents.get(edge.to)?.add(edge.from);
  }

  // Check if treatment and outcome nodes exist
  const missingNodes = validateNodesExist(dag, [treatment_node, outcome_node]);
  if (missingNodes.length > 0) {
    return {
      identifiable: false,
      summary: 'Identifiable: No',
      adjustment_set: [],
      notes: [`Nodes not found in graph: ${missingNodes.join(', ')}`],
      reason: 'node not found',
      dag_validation: dagValidation,
    };
  }

  // Simplified identifiability check:
  // 1. Find all paths from treatment to outcome
  // 2. Find confounders (common causes of treatment and outcome)
  // 3. Adjustment set = confounders + parents of treatment (backdoor criterion)

  const confounders = findConfounders(graph, treatment_node, outcome_node, parents);
  const treatment_parents = Array.from(parents.get(treatment_node) || []);

  // Combine and deduplicate
  const adjustment_set = [...new Set([...confounders, ...treatment_parents])];

  // Remove treatment and outcome from adjustment set
  const filtered_adjustment_set = adjustment_set.filter(
    node => node !== treatment_node && node !== outcome_node
  );

  // Check if there's a direct path
  const has_path = hasPath(treatment_node, outcome_node, children);

  if (!has_path) {
    return {
      identifiable: false,
      summary: 'Identifiable: No',
      adjustment_set: [],
      notes: ['No causal path from treatment to outcome'],
      reason: 'no causal path',
      dag_validation: dagValidation,
      adjustment_metadata: {
        variables: [],
        labels: [],
        blocks_backdoor_paths: false,
        d_separation_verified: false,
        criterion: 'none',
      },
    };
  }

  // Sort adjustment set for determinism
  const sorted_adjustment_set = filtered_adjustment_set.sort();

  // Optional: verify adjustment set using d-separation
  let d_separation_verified = false;
  let blocks_backdoor_paths = sorted_adjustment_set.length === 0;

  if (process.env.IDENT_DSEP_ENABLE === '1') {
    const dsepResult = computeIdentifiabilityDSep(dag, treatment_node, outcome_node);
    d_separation_verified = true;
    blocks_backdoor_paths = dsepResult.identifiable;

    // Use d-separation based adjustment set if available
    if (dsepResult.adjustment_set.length > 0) {
      sorted_adjustment_set.length = 0;
      sorted_adjustment_set.push(...dsepResult.adjustment_set);
    }
  }

  // Build adjustment metadata
  const adjustment_labels = sorted_adjustment_set.map(
    (id) => graph.nodes.find((n) => n.id === id)?.label || id
  );

  const adjustment_metadata: AdjustmentSetMetadata = {
    variables: sorted_adjustment_set,
    labels: adjustment_labels,
    blocks_backdoor_paths,
    d_separation_verified,
    criterion: sorted_adjustment_set.length > 0 ? 'backdoor' : 'none',
  };

  // Build summary and notes
  const identifiable = blocks_backdoor_paths || !d_separation_verified;
  const notes: string[] = [];

  let summary: string;
  if (sorted_adjustment_set.length === 0) {
    summary = 'Identifiable: Yes. No confounders detected - direct causal effect estimable.';
    notes.push('Direct causal effect estimable');
    notes.push('Acyclic graph assumption');
  } else {
    const node_labels = adjustment_labels.join(', ');
    summary = `Identifiable: Yes. Adjust for: ${node_labels}`;
    notes.push(`Backdoor criterion: adjust for ${sorted_adjustment_set.length} confounder(s)`);
    notes.push('Acyclic graph assumption');
  }

  if (d_separation_verified) {
    notes.push('Verified via d-separation (Bayes-ball algorithm)');
  }

  return {
    identifiable,
    summary,
    adjustment_set: sorted_adjustment_set,
    notes,
    adjustment_metadata,
    dag_validation: dagValidation,
  };
}

/**
 * Find confounders (nodes that are parents of both treatment and outcome)
 * Returns sorted list for determinism
 */
function findConfounders(
  graph: Graph,
  treatment: string,
  outcome: string,
  parents: Map<string, Set<string>>
): string[] {
  const treatment_ancestors = getAncestors(treatment, parents);
  const outcome_ancestors = getAncestors(outcome, parents);

  const confounders: string[] = [];
  for (const node of treatment_ancestors) {
    if (outcome_ancestors.has(node) && node !== treatment && node !== outcome) {
      confounders.push(node);
    }
  }

  // Sort for determinism
  return confounders.sort();
}

/**
 * Get all ancestors of a node
 */
function getAncestors(node: string, parents: Map<string, Set<string>>): Set<string> {
  const ancestors = new Set<string>();
  const queue: string[] = [node];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const parent_set = parents.get(current) || new Set();
    for (const parent of parent_set) {
      ancestors.add(parent);
      queue.push(parent);
    }
  }

  return ancestors;
}

/**
 * Check if there's a path from source to target
 */
function hasPath(
  source: string,
  target: string,
  children: Map<string, Set<string>>
): boolean {
  const queue: string[] = [source];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const child_set = children.get(current) || new Set();
    for (const child of child_set) {
      queue.push(child);
    }
  }

  return false;
}
