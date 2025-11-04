/**
 * Explainability atoms for "Why" panel
 * Provides top contributors and key paths based on edge weights and beliefs
 */

export interface TopContributor {
  edge_id: string;
  weight: number;
  belief?: number;
  impact_pct: number;
  provenance?: string;
}

export interface KeyPath {
  path: string[];
  path_impact_pct: number;
}

export interface ExplainabilityAtoms {
  top_contributors: TopContributor[];
  key_paths: KeyPath[];
}

/**
 * Compute explainability atoms from graph
 * Omit for graphs > maxNodes to keep payloads lean
 */
export function computeExplainability(
  graph: any,
  outcomeNode: string,
  maxNodes: number = 12
): ExplainabilityAtoms | undefined {
  if (!graph || !graph.nodes || !graph.edges) return undefined;
  if (graph.nodes.length > maxNodes) return undefined;
  
  const edges = graph.edges || [];
  if (edges.length === 0) return undefined;
  
  // Compute impact for each edge (simple variance contribution approximation)
  const edgeImpacts: Array<{
    edge_id: string;
    weight: number;
    belief: number | undefined;
    provenance: string | undefined;
    impact: number;
  }> = [];
  
  let totalImpact = 0;
  
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const weight = edge.weight || 0;
    const belief = edge.belief;
    
    // Simple impact: |weight| * belief (or 1.0 if no belief)
    const impact = Math.abs(weight) * (typeof belief === 'number' ? belief : 1.0);
    totalImpact += impact;
    
    edgeImpacts.push({
      edge_id: `${edge.from}::${edge.to}::${i}`,
      weight,
      belief,
      provenance: edge.provenance,
      impact,
    });
  }
  
  // Sort by impact descending
  edgeImpacts.sort((a, b) => b.impact - a.impact);
  
  // Top 5 contributors with impact_pct
  const top_contributors: TopContributor[] = edgeImpacts
    .slice(0, 5)
    .map(e => ({
      edge_id: e.edge_id,
      weight: e.weight,
      ...(e.belief !== undefined && { belief: e.belief }),
      impact_pct: totalImpact > 0 ? (e.impact / totalImpact) * 100 : 0,
      ...(e.provenance && { provenance: e.provenance }),
    }));
  
  // Compute key paths (simple: find paths to outcome node)
  const key_paths: KeyPath[] = findKeyPaths(graph, outcomeNode, 3);
  
  return {
    top_contributors,
    key_paths,
  };
}

/**
 * Find key causal paths to outcome node (simple BFS)
 */
function findKeyPaths(graph: any, outcomeNode: string, maxPaths: number): KeyPath[] {
  const edges = graph.edges || [];
  const nodes = graph.nodes || [];
  
  // Build adjacency list (reverse: to -> from)
  const incoming: Map<string, string[]> = new Map();
  const edgeWeights: Map<string, number> = new Map();
  
  for (const edge of edges) {
    if (!incoming.has(edge.to)) {
      incoming.set(edge.to, []);
    }
    incoming.get(edge.to)!.push(edge.from);
    edgeWeights.set(`${edge.from}->${edge.to}`, Math.abs(edge.weight || 0));
  }
  
  // Find root nodes (no incoming edges)
  const roots = nodes
    .map((n: any) => n.id)
    .filter((id: string) => !incoming.has(id) || incoming.get(id)!.length === 0);
  
  // BFS from outcome back to roots
  const paths: Array<{ path: string[]; impact: number }> = [];
  const queue: Array<{ node: string; path: string[]; impact: number }> = [
    { node: outcomeNode, path: [outcomeNode], impact: 1.0 },
  ];
  const visited = new Set<string>();
  
  while (queue.length > 0 && paths.length < maxPaths * 3) {
    const { node, path, impact } = queue.shift()!;
    
    if (roots.includes(node)) {
      paths.push({ path: path.reverse(), impact });
      continue;
    }
    
    const parents = incoming.get(node) || [];
    for (const parent of parents) {
      const key = `${parent}-${node}-${path.join(',')}`;
      if (visited.has(key)) continue;
      visited.add(key);
      
      const edgeWeight = edgeWeights.get(`${parent}->${node}`) || 0;
      const newImpact = impact * edgeWeight;
      
      queue.push({
        node: parent,
        path: [...path, parent],
        impact: newImpact,
      });
    }
  }
  
  // Sort by impact and take top N
  paths.sort((a, b) => b.impact - a.impact);
  
  return paths.slice(0, maxPaths).map(p => ({
    path: p.path,
    path_impact_pct: p.impact * 100,
  }));
}
