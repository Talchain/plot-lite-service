/**
 * Provenance Hook - Pass through "where this came from" metadata
 * Accepts optional edge.provenance_note and aggregates into model_card.sources
 */

export interface GraphEdgeWithProvenance {
  from: string;
  to: string;
  weight?: number;
  provenance_note?: string; // Optional: "Study XYZ 2023", "Expert estimate", etc.
}

export interface GraphWithProvenance {
  nodes: Array<{ id: string; label: string }>;
  edges: GraphEdgeWithProvenance[];
}

/**
 * Extract unique provenance sources from graph edges
 * Returns sorted list for determinism
 */
export function extractProvenanceSources(graph: GraphWithProvenance): string[] {
  const sources = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.provenance_note && edge.provenance_note.trim().length > 0) {
      sources.add(edge.provenance_note.trim());
    }
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
  const edges_with_provenance = graph.edges.filter(e => 
    e.provenance_note && e.provenance_note.trim().length > 0
  ).length;

  return {
    sources,
    source_count: sources.length,
    edges_with_provenance,
    edges_total: graph.edges.length,
  };
}
