/**
 * Compute quantiles from sorted samples (constant-time extraction)
 */
export function computeQuantiles(
  samples: number[],
  quantiles: number[] = [0.1, 0.5, 0.9]
): Record<string, number> {
  if (samples.length === 0) return {};
  
  const sorted = [...samples].sort((a, b) => a - b);
  const result: Record<string, number> = {};
  
  for (const q of quantiles) {
    const index = Math.floor(q * (sorted.length - 1));
    const key = `p${Math.round(q * 100)}`;
    result[key] = sorted[index];
  }
  
  return result;
}

/**
 * Compute bands (p10, p50, p90) for outcome nodes from Monte Carlo samples
 */
export function computeBands(
  samples: Array<{ outcomes: Record<string, number> }>,
  outcomeNodes: string[]
): { p10: { outcomes: Record<string, number> }; p50: { outcomes: Record<string, number> }; p90: { outcomes: Record<string, number> } } | undefined {
  if (samples.length === 0 || outcomeNodes.length === 0) return undefined;
  
  const bands: any = {
    p10: { outcomes: {} },
    p50: { outcomes: {} },
    p90: { outcomes: {} },
  };
  
  // For each outcome node, extract quantiles across samples
  for (const outcomeNode of outcomeNodes) {
    const values = samples
      .map(s => s.outcomes[outcomeNode])
      .filter(v => typeof v === 'number' && isFinite(v));
    
    if (values.length === 0) continue;
    
    const quantiles = computeQuantiles(values, [0.1, 0.5, 0.9]);
    bands.p10.outcomes[outcomeNode] = quantiles.p10;
    bands.p50.outcomes[outcomeNode] = quantiles.p50;
    bands.p90.outcomes[outcomeNode] = quantiles.p90;
  }
  
  return bands;
}

/**
 * Compute simple compare deltas between two options
 */
export function computeCompare(
  optionA: string,
  optionB: string,
  bandsA: any,
  bandsB: any
): Record<string, any> | undefined {
  if (!bandsA || !bandsB) return undefined;
  
  const compare: Record<string, any> = {};
  const key = `${optionA}_vs_${optionB}`;
  
  // Extract first outcome node for simplicity (can be extended)
  const outcomeNodes = Object.keys(bandsA.p50.outcomes || {});
  if (outcomeNodes.length === 0) return undefined;
  
  const outcomeNode = outcomeNodes[0];
  const aP50 = bandsA.p50.outcomes[outcomeNode];
  const bP50 = bandsB.p50.outcomes[outcomeNode];
  const aP10 = bandsA.p10.outcomes[outcomeNode];
  const bP10 = bandsB.p10.outcomes[outcomeNode];
  const aP90 = bandsA.p90.outcomes[outcomeNode];
  const bP90 = bandsB.p90.outcomes[outcomeNode];
  
  if (typeof aP50 === 'number' && typeof bP50 === 'number') {
    compare[key] = {
      delta_p50: bP50 - aP50,
      delta_p10: typeof aP10 === 'number' && typeof bP10 === 'number' ? bP10 - aP10 : undefined,
      delta_p90: typeof aP90 === 'number' && typeof bP90 === 'number' ? bP90 - aP90 : undefined,
    };
  }
  
  return Object.keys(compare).length > 0 ? compare : undefined;
}
