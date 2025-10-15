/**
 * D-separation for identifiability (E3)
 * Minimal DAG utilities for backdoor criterion
 */

export interface DAG {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

/**
 * Check if path is d-separated given conditioning set
 */
export function isDSeparated(
  dag: DAG,
  from: string,
  to: string,
  conditioningSet: Set<string>
): boolean {
  // Simplified: check if any backdoor path exists
  const backdoorPaths = findBackdoorPaths(dag, from, to);
  
  // All backdoor paths must be blocked by conditioning set
  return backdoorPaths.every(path => 
    path.some(node => conditioningSet.has(node))
  );
}

function findBackdoorPaths(dag: DAG, from: string, to: string): string[][] {
  // Simplified backdoor detection: paths with common ancestors
  const paths: string[][] = [];
  const ancestors = new Set<string>();
  
  // Find ancestors of 'from'
  for (const edge of dag.edges) {
    if (edge.to === from) {
      ancestors.add(edge.from);
    }
  }
  
  // Check if any ancestor also reaches 'to'
  for (const anc of ancestors) {
    if (hasPath(dag, anc, to)) {
      paths.push([anc]);
    }
  }
  
  return paths;
}

function hasPath(dag: DAG, from: string, to: string): boolean {
  const visited = new Set<string>();
  const queue = [from];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    
    for (const edge of dag.edges) {
      if (edge.from === current) {
        queue.push(edge.to);
      }
    }
  }
  
  return false;
}

/**
 * Compute identifiability tag (E3)
 */
export function computeIdentifiability(
  dag: DAG,
  treatment: string,
  outcome: string
): { identifiable: boolean; adjustment_set: string[] } {
  if (process.env.IDENT_DSEP_ENABLE !== '1') {
    return { identifiable: true, adjustment_set: [] };
  }
  
  // Find minimal adjustment set (backdoor criterion)
  const allNodes = new Set(dag.nodes);
  allNodes.delete(treatment);
  allNodes.delete(outcome);
  
  // Try empty set first
  if (isDSeparated(dag, treatment, outcome, new Set())) {
    return { identifiable: true, adjustment_set: [] };
  }
  
  // Try single-node conditioning
  for (const node of allNodes) {
    if (isDSeparated(dag, treatment, outcome, new Set([node]))) {
      return { identifiable: true, adjustment_set: [node] };
    }
  }
  
  return { identifiable: false, adjustment_set: [] };
}
