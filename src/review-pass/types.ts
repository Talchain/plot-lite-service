/**
 * ReviewPass types — Deterministic review cards from facts and validation.
 *
 * Design principles:
 * - Fully deterministic in PLoT (no LLM for v0)
 * - Cards cite facts via SupportingRef with explicit roles
 * - Bytewise sorting for stable ordering
 * - Max 5 cards per phase, truncation tracked
 *
 * REVIEW PASS CONTRACT v1
 *
 * Breaking changes require version bump:
 * - Adding/removing required fields
 * - Changing card_id generation logic
 * - Changing sort order (priority, card_type, card_id)
 * - Changing truncation limit (currently 5)
 *
 * Non-breaking (no version bump):
 * - Adding optional fields
 * - Extending allow-list patterns
 *
 * Potentially breaking for strict/generated clients (coordinate with consumers):
 * - Adding new card_type values (OpenAPI enum expansion)
 */

export const REVIEW_PASS_SCHEMA_VERSION = 1;

export type CitationRole = 'supports' | 'explains' | 'derived_from';

export interface Citation {
  fact_id: string;
  role: CitationRole;
}

/** Fact ref — role is required (citations must declare their relationship). */
export interface FactRef {
  kind: 'fact';
  id: string;
  role: CitationRole;
}

/** Violation/critique ref — role is optional. */
export interface ViolationRef {
  kind: 'violation' | 'critique';
  id: string;
  role?: CitationRole;
}

/** Discriminated union: facts require role, violations/critiques don't. */
export type SupportingRef = FactRef | ViolationRef;

export type CardType = 'challenge' | 'gap' | 'fragile' | 'warning' | 'structural';
export type ReviewPhase = 'pre_analysis' | 'post_analysis';
export type SuggestedAction = 'review' | 'update_belief' | 'add_evidence' | 'dismiss';

/** UI-friendly priority label derived from numeric priority. */
export type PriorityBand = 'critical' | 'high' | 'medium' | 'low';

/** Maps numeric priority → UI-friendly band. */
export const PRIORITY_TO_BAND: Record<number, PriorityBand> = {
  1: 'critical',
  2: 'high',
  3: 'medium',
  4: 'low',
};

/** Lookup priority band with fail-fast for unmapped priorities. */
export function lookupBand(priority: number): PriorityBand {
  const band = PRIORITY_TO_BAND[priority];
  if (!band) {
    throw new Error(`Unmapped priority ${priority} — update PRIORITY_TO_BAND`);
  }
  return band;
}

/** Provenance tracking — which subsystem produced this card. */
export interface CardProvenance {
  /** Source subsystem: 'validate' for pre-analysis, 'isl' for post-analysis. */
  source: 'validate' | 'isl';
  /** Origin identifier: violation.code or fact.fact_id. */
  origin_id: string;
}

export interface ProposalCardV1 {
  card_id: string;
  card_type: CardType;
  review_phase: ReviewPhase;

  what: string;
  why: string;
  impact?: string;

  supporting_refs: SupportingRef[];

  affected_node_ids?: string[];
  affected_edge_ids?: string[];

  priority: number;
  /** UI-friendly priority label. */
  priority_band: PriorityBand;
  suggested_action?: SuggestedAction;
  /** Source provenance for auditability. */
  provenance: CardProvenance;
}

export interface ReviewPassEnvelopeV1 {
  review_pass_schema_version: 1;
  phase: ReviewPhase;
  cards: ProposalCardV1[];
  truncated: boolean;
  total_candidates: number;
}
