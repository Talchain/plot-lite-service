/**
 * Provenance Hook - Pass through "where this came from" metadata
 * Accepts optional edge.provenance_note (whiteboard flows) or edge.provenance (engine GraphV1)
 * and aggregates into stable source lists and counts.
 */

import type { ProvenanceConfidenceLevel, ProvenanceSummary } from './types.js';

export interface GraphEdgeWithProvenance {
  from: string;
  to: string;
  weight?: number;
  // Whiteboard flows: explicit provenance_note field
  provenance_note?: string; // Optional: "Study XYZ 2023", "Expert estimate", etc.
  // Engine GraphV1: reuse GraphEdge.provenance when present
  provenance?: string;
}

export interface GraphWithProvenance {
  nodes: Array<{ id: string; label: string }>;
  edges: GraphEdgeWithProvenance[];
}

/**
 * Extract unique provenance sources from graph edges
 * Returns sorted list for determinism
 */
// Treat these labels as assumptions rather than external evidence
const ASSUMPTION_LABELS = new Set(['template', 'assumption']);

export function extractProvenanceSources(graph: GraphWithProvenance): string[] {
  const sources = new Set<string>();

  for (const edge of graph.edges) {
    const raw = edge.provenance_note ?? (edge as any).provenance;
    if (typeof raw !== 'string') continue;

    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Skip assumption-only labels; we only want external evidence sources
    if (ASSUMPTION_LABELS.has(trimmed.toLowerCase())) continue;

    sources.add(trimmed);
  }

  // Sort for determinism
  return Array.from(sources).sort();
}

/**
 * Format sources for display
 * Returns comma-separated list or "No sources specified"
 */
export function formatSources(sources: string[]): string {
  if (sources.length === 0) {
    return 'No sources specified';
  }
  if (sources.length === 1) {
    return sources[0];
  }
  if (sources.length === 2) {
    return `${sources[0]} and ${sources[1]}`;
  }
  // 3 or more: "A, B, and C"
  const last = sources[sources.length - 1];
  const rest = sources.slice(0, -1).join(', ');
  return `${rest}, and ${last}`;
}

export function validateProvenanceNote(note: string | undefined): string | null {
  if (!note) return null;
  
  const cleaned = note.trim();
  
  // Reject empty or too long
  if (cleaned.length === 0) return null;
  if (cleaned.length > 200) return null;
  
  // Reject if contains only special characters
  if (!/[a-zA-Z0-9]/.test(cleaned)) return null;
  
  return cleaned;
}
/**
 * Validate an ISO 8601 timestamp string.
 *
 * Accepts strings that Date.parse can interpret and rejects empty/invalid
 * values. Intended for light-weight validation of provenance metadata.
 */
export function isValidIsoTimestamp(value: string | undefined | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  let date: Date;
  try {
    date = new Date(trimmed);
  } catch {
    return false;
  }

  if (Number.isNaN(date.getTime())) return false;

  // Require canonical round-trip to avoid accepting loosely parsed dates
  // such as invalid months that JS normalises.
  try {
    return date.toISOString() === trimmed;
  } catch {
    return false;
  }
}
/**
 * Classify provenance coverage into a confidence level and score.
 *
 * Heuristic inputs:
 * - edgesWithProvenance / edgesTotal → coverage_ratio (0-1)
 * - sourceCount → small bonus for diverse sources.
 *
 * Returns a lowercase confidence level and a 0-1 score rounded to 2 d.p.
 */
export function classifyProvenanceConfidence(
  edgesWithProvenance: number,
  edgesTotal: number,
  sourceCount: number,
): { level: ProvenanceConfidenceLevel; score: number } {
  if (edgesTotal <= 0) {
    return { level: 'unknown', score: 0 };
  }

  const coverage = Math.max(0, Math.min(1, edgesWithProvenance / edgesTotal));

  // Simple heuristic: reward more distinct sources slightly
  let score = coverage;
  if (sourceCount >= 3) score += 0.15;
  else if (sourceCount >= 1) score += 0.05;

  score = Math.max(0, Math.min(1, score));

  let level: ProvenanceConfidenceLevel;
  if (edgesWithProvenance === 0) {
    level = 'low';
  } else if (score >= 0.75) {
    level = 'high';
  } else if (score >= 0.4) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { level, score: Number(score.toFixed(2)) };
}

/**
 * Aggregate provenance metadata for model card
 */
export function aggregateProvenance(graph: GraphWithProvenance): ProvenanceSummary {
  const sources = extractProvenanceSources(graph);

  let edges_with_provenance = 0;
  for (const edge of graph.edges) {
    const raw = edge.provenance_note ?? (edge as any).provenance;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (ASSUMPTION_LABELS.has(trimmed.toLowerCase())) continue;
    edges_with_provenance++;
  }

  const edges_total = graph.edges.length;
  const coverage_ratio = edges_total > 0 ? edges_with_provenance / edges_total : 0;

  const { level, score } = classifyProvenanceConfidence(edges_with_provenance, edges_total, sources.length);

  const collected_at = new Date().toISOString();

  return {
    sources,
    source_count: sources.length,
    edges_with_provenance,
    edges_total,
    coverage_ratio: Number(coverage_ratio.toFixed(2)),
    confidence_level: level,
    confidence_score: score,
    collected_at,
  };
}
