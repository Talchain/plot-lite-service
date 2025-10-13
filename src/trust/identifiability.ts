/**
 * Identifiability Helper
 * Returns "Identifiable: Yes/No" plus adjustment set in one sentence
 */

import type { Graph } from './types.js';

export interface IdentifiabilityResult {
  identifiable: boolean;
  summary: string;
  adjustment_set: string[];
  notes: string[];
  reason?: string;
}

export interface IdentifiabilityInputs {
  graph: Graph;
  treatment_node: string;
  outcome_node: string;
}

/**
 * Check identifiability and suggest adjustment set
 * Simplified implementation - real version would use d-separation
 */
export function checkIdentifiability(inputs: IdentifiabilityInputs): IdentifiabilityResult {
  const { graph, treatment_node, outcome_node } = inputs;

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
  const treatment_exists = graph.nodes.some(n => n.id === treatment_node);
  const outcome_exists = graph.nodes.some(n => n.id === outcome_node);

  if (!treatment_exists || !outcome_exists) {
    return {
      identifiable: false,
      summary: 'Identifiable: No',
      adjustment_set: [],
      notes: ['Treatment or outcome node not found in graph'],
      reason: 'node not found',
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
    };
  }

  // Sort adjustment set for determinism
  const sorted_adjustment_set = filtered_adjustment_set.sort();

  // Build summary and notes
  const identifiable = true; // Simplified - assume identifiable if we can find adjustment set
  const notes: string[] = [];
  
  let summary: string;
  if (sorted_adjustment_set.length === 0) {
    summary = 'Identifiable: Yes. No confounders detected - direct causal effect estimable.';
    notes.push('Direct causal effect estimable');
    notes.push('Acyclic graph assumption');
  } else {
    const node_labels = sorted_adjustment_set
      .map(id => graph.nodes.find(n => n.id === id)?.label || id)
      .join(', ');
    summary = `Identifiable: Yes. Adjust for: ${node_labels}`;
    notes.push(`Backdoor criterion: adjust for ${sorted_adjustment_set.length} confounder(s)`);
    notes.push('Acyclic graph assumption');
  }

  return {
    identifiable,
    summary,
    adjustment_set: sorted_adjustment_set,
    notes,
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
