// Normalize edge: map confidence|probability → belief
// addDefaultBelief: if true, set belief=1.0 when undefined (emit-only)
export function normalizeEdge(edge: any, addDefaultBelief = false): any {
  const e = { ...edge };
  if (e.confidence !== undefined) {
    e.belief = e.confidence;
    delete e.confidence;
  } else if (e.probability !== undefined) {
    e.belief = e.probability;
    delete e.probability;
  }
  if (addDefaultBelief && e.belief === undefined) e.belief = 1.0;
  return e;
}

export function normalizeGraph(graph: any, addDefaultBelief = false): any {
  if (!graph || !graph.edges) return graph;
  return {
    ...graph,
    edges: (graph.edges || []).map((e: any) => normalizeEdge(e, addDefaultBelief))
  };
}
