/**
 * Provenance Hook - Pass through "where this came from" metadata
 * Accepts optional edge.provenance_note (whiteboard flows) or edge.provenance (engine GraphV1)
 * and aggregates into stable source lists and counts.
 */

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

/**
 * Validate provenance notes (basic sanitization)
 * Returns cleaned note or null if invalid
 */
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
 * Aggregate provenance metadata for model card
 */
export function aggregateProvenance(graph: GraphWithProvenance): {
  sources: string[];
  source_count: number;
  edges_with_provenance: number;
  edges_total: number;
} {
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

  return {
    sources,
    source_count: sources.length,
    edges_with_provenance,
    edges_total: graph.edges.length,
  };
}
