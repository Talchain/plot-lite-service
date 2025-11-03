// Normalize edge: map confidence|probability → belief, default=1.0
export function normalizeEdge(edge: any): any {
  const e = { ...edge };
  if (e.confidence !== undefined) {
    e.belief = e.confidence;
    delete e.confidence;
  } else if (e.probability !== undefined) {
    e.belief = e.probability;
    delete e.probability;
  }
  if (e.belief === undefined) e.belief = 1.0;
  return e;
}

export function normalizeGraph(graph: any): any {
  return {
    ...graph,
    edges: graph.edges.map(normalizeEdge)
  };
}
