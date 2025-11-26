/**
 * Evidence-Aware Critique
 * Identifies which model parts are backed by evidence vs assumptions
 *
 * Evidence-backed: provenance NOT in ['template', 'assumption']
 * Assumption-based: provenance IS 'template' or 'assumption'
 */

/**
 * Edge with provenance metadata
 */
export interface EdgeWithProvenance {
  id: string;
  from: string;
  to: string;
  provenance?: string;
}

/**
 * Top driver from sensitivity analysis
 */
export interface TopDriver {
  edge_id: string;
  score: number;
}

/**
 * Critical gap - a top driver that lacks evidence backing
 */
export interface CriticalGap {
  edge_id: string;
  reason: string;
}

/**
 * Evidence analysis result
 */
export interface EvidenceAnalysis {
  evidence_backed_edges: string[];    // edge IDs with evidence
  assumption_edges: string[];          // edge IDs based on assumptions
  coverage_pct: number;                // 0-100, percentage with evidence
  critical_gaps: CriticalGap[];        // top drivers lacking evidence (max 3)
}

/**
 * Provenance values that indicate assumption-based edges
 */
const ASSUMPTION_PROVENANCES = new Set(['template', 'assumption']);

/**
 * Maximum number of critical gaps to report
 */
const MAX_CRITICAL_GAPS = 3;

/**
 * Maximum length for provenance labels in user-facing messages (privacy protection)
 */
const MAX_PROVENANCE_LABEL_LENGTH = 40;

/**
 * Check if an edge is evidence-backed (has real provenance)
 */
export function isEvidenceBacked(provenance: string | undefined): boolean {
  if (!provenance) return false;
  const normalised = provenance.trim().toLowerCase();
  return normalised.length > 0 && !ASSUMPTION_PROVENANCES.has(normalised);
}

/**
 * Sanitize provenance label for user-facing messages
 * - Truncates to max length
 * - Maps to safe category if recognized
 * - Removes potentially sensitive patterns
 */
export function sanitizeProvenanceLabel(provenance: string | undefined): string {
  if (!provenance) return 'unspecified';

  const trimmed = provenance.trim().toLowerCase();

  if (trimmed.length === 0) return 'unspecified';

  // Map known assumption types
  if (ASSUMPTION_PROVENANCES.has(trimmed)) {
    return trimmed; // 'template' or 'assumption' - safe to expose
  }

  // Categorize common evidence types for privacy
  if (trimmed.includes('study') || trimmed.includes('research')) return 'research-based';
  if (trimmed.includes('expert') || trimmed.includes('judgment')) return 'expert-based';
  if (trimmed.includes('survey') || trimmed.includes('poll')) return 'survey-based';
  if (trimmed.includes('data') || trimmed.includes('historical')) return 'data-based';

  // For other provenance, truncate and indicate it's custom
  if (trimmed.length > MAX_PROVENANCE_LABEL_LENGTH) {
    return 'custom evidence';
  }

  // Return truncated generic label (don't echo raw user input)
  return 'custom evidence';
}

/**
 * Analyse evidence coverage in the model
 *
 * @param params.edges - All edges in the graph with provenance metadata
 * @param params.top_drivers - Top drivers from sensitivity analysis
 * @returns Evidence analysis with coverage and critical gaps
 */
export function analyseEvidence(params: {
  edges: EdgeWithProvenance[];
  top_drivers: TopDriver[];
}): EvidenceAnalysis {
  const { edges, top_drivers } = params;

  // Categorise edges by evidence backing
  const evidence_backed_edges: string[] = [];
  const assumption_edges: string[] = [];
  const edgeProvenanceMap = new Map<string, string | undefined>();

  for (const edge of edges) {
    edgeProvenanceMap.set(edge.id, edge.provenance);

    if (isEvidenceBacked(edge.provenance)) {
      evidence_backed_edges.push(edge.id);
    } else {
      assumption_edges.push(edge.id);
    }
  }

  // Calculate coverage percentage
  const total = edges.length;
  const coverage_pct = total > 0
    ? Math.round((evidence_backed_edges.length / total) * 100)
    : 0;

  // Identify critical gaps: top drivers that are assumption-based
  const critical_gaps: CriticalGap[] = [];

  for (const driver of top_drivers) {
    if (critical_gaps.length >= MAX_CRITICAL_GAPS) break;

    const provenance = edgeProvenanceMap.get(driver.edge_id);

    if (!isEvidenceBacked(provenance)) {
      const provenanceLabel = sanitizeProvenanceLabel(provenance);
      critical_gaps.push({
        edge_id: driver.edge_id,
        reason: `High-impact edge (score: ${driver.score.toFixed(2)}) relies on ${provenanceLabel} provenance`,
      });
    }
  }

  // Sort for determinism
  evidence_backed_edges.sort();
  assumption_edges.sort();

  return {
    evidence_backed_edges,
    assumption_edges,
    coverage_pct,
    critical_gaps,
  };
}

/**
 * Generate a human-readable summary of evidence analysis
 */
export function summariseEvidenceAnalysis(analysis: EvidenceAnalysis): string {
  const { coverage_pct, critical_gaps, evidence_backed_edges, assumption_edges } = analysis;

  const total = evidence_backed_edges.length + assumption_edges.length;

  if (total === 0) {
    return 'No edges to analyse.';
  }

  let summary = `Evidence coverage: ${coverage_pct}% (${evidence_backed_edges.length}/${total} edges backed by data).`;

  if (critical_gaps.length > 0) {
    summary += ` ${critical_gaps.length} critical gap${critical_gaps.length > 1 ? 's' : ''} identified in high-impact edges.`;
  } else if (coverage_pct < 100) {
    summary += ' No critical gaps in top drivers.';
  }

  return summary;
}
