export interface SensitivityEdge {
  id: string;
  label?: string;
  weight: number;
  belief: number;
  provenance: string;
  rank: number;
}

export interface SensitivityResult {
  option_id: string;
  p10: number;
  p50: number;
  p90: number;
  top3_edges: SensitivityEdge[];
}

export function computeSensitivity(
  draws: number[],
  masks: boolean[][],
  edges: any[],
  optionId: string
): SensitivityResult {
  const K = draws.length;
  const E = edges.length;
  
  // Compute mean outcome
  const meanOutcome = draws.reduce((a, b) => a + b, 0) / K;
  
  // Compute sensitivity score for each edge: |cov(edge_active, outcome)|
  const scores = edges.map((edge, edgeIdx) => {
    let cov = 0;
    let meanActive = 0;
    
    for (let k = 0; k < K; k++) {
      const active = masks[k]?.[edgeIdx] ? 1 : 0;
      meanActive += active;
    }
    meanActive /= K;
    
    for (let k = 0; k < K; k++) {
      const active = masks[k]?.[edgeIdx] ? 1 : 0;
      cov += (active - meanActive) * (draws[k] - meanOutcome);
    }
    cov /= K;
    
    const edgeId = `${edge.from}::${edge.to}::${edgeIdx}`;
    return {
      id: edgeId,
      label: edge.label,
      weight: edge.weight,
      belief: edge.belief || 1.0,
      provenance: edge.provenance || 'template',
      score: Math.abs(cov),
    };
  });
  
  // Sort by score desc, tiebreak by id asc
  scores.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 1e-10) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });
  
  // Top 3
  const top3_edges = scores.slice(0, 3).map((s, i) => ({
    id: s.id,
    label: s.label,
    weight: s.weight,
    belief: s.belief,
    provenance: s.provenance,
    rank: i + 1,
  }));
  
  // Compute percentiles
  const sorted = [...draws].sort((a, b) => a - b);
  const p10 = sorted[Math.floor(K * 0.1)] || 0;
  const p50 = sorted[Math.floor(K * 0.5)] || 0;
  const p90 = sorted[Math.floor(K * 0.9)] || 0;
  
  return { option_id: optionId, p10, p50, p90, top3_edges };
}
