/**
 * D-separation for identifiability (F3)
 * Improved backdoor criterion with transitive ancestors
 * TODO: Full Bayes-ball algorithm for collider-opening detection
 */

export interface DAG {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

function findAllAncestors(dag: DAG, node: string): Set<string> {
  const ancestors = new Set<string>();
  const queue = [node];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    
    for (const edge of dag.edges) {
      if (edge.to === current && !ancestors.has(edge.from)) {
        ancestors.add(edge.from);
        queue.push(edge.from);
      }
    }
  }
  
  return ancestors;
}

export function computeIdentifiability(
  dag: DAG,
  treatment: string,
  outcome: string
): { identifiable: boolean; adjustment_set: string[] } {
  if (process.env.IDENT_DSEP_ENABLE !== '1') {
    return { identifiable: true, adjustment_set: [] };
  }
  
  // Find common ancestors (backdoor paths)
  const treatmentAncestors = findAllAncestors(dag, treatment);
  const outcomeAncestors = findAllAncestors(dag, outcome);
  
  const confounders: string[] = [];
  for (const anc of treatmentAncestors) {
    if (outcomeAncestors.has(anc)) {
      confounders.push(anc);
    }
  }
  
  // Deterministic sort
  confounders.sort();
  
  if (confounders.length === 0) {
    return { identifiable: true, adjustment_set: [] };
  }
  
  return { identifiable: true, adjustment_set: confounders };
}
