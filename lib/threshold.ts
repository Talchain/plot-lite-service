export type ThresholdCrossing = {
  node_id: string;
  threshold: number;
  crossed_from: number;
  crossed_to: number;
};

const DEFAULT_CATALOGUE = ["£x9", "£x99", "£99", "£199"] as const;
export type CatalogueItem = typeof DEFAULT_CATALOGUE[number];

function normaliseToken(token: string): string {
  // Treat £ and $ equivalently for numeric thresholds
  return token.replace(/^[$£]/, '£');
}

function parseCatalogue(catalogue: readonly string[], min: number, max: number): number[] {
  const candidates = new Set<number>();
  for (const raw of catalogue) {
    const item = normaliseToken(raw);
    if (item === "£x9") {
      // all integers ending with 9 within [min, max)
      const start = Math.ceil(min);
      const end = Math.floor(max - 1);
      for (let t = start; t <= end; t++) {
        if (t % 10 === 9) candidates.add(t);
      }
    } else if (item === "£x99") {
      const start = Math.ceil(min);
      const end = Math.floor(max - 1);
      for (let t = start; t <= end; t++) {
        if (t % 100 === 99) candidates.add(t);
      }
    } else if (item === "£99") {
      if (min <= 99 && 99 < max) candidates.add(99);
    } else if (item === "£199") {
      if (min <= 199 && 199 < max) candidates.add(199);
    }
  }
  return Array.from(candidates).sort((a, b) => a - b);
}

export function computeThresholdCrossings(
  node_id: string,
  from: number,
  to: number,
  catalogue: readonly string[] = DEFAULT_CATALOGUE
): ThresholdCrossing[] {
  const min = Math.min(from, to);
  const max = Math.max(from, to);
  const thresholds = parseCatalogue(catalogue, min, max);

  const results: ThresholdCrossing[] = [];
  for (const T of thresholds) {
    const upward = from <= T && T < to;
    const downward = to <= T && T < from;
    if (upward || downward) {
      results.push({ node_id, threshold: T, crossed_from: from, crossed_to: to });
    }
  }
  return results;
}