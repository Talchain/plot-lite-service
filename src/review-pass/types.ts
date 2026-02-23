/**
 * ReviewPass types — Deterministic review cards from facts and validation.
 *
 * Design principles:
 * - Fully deterministic in PLoT (no LLM for v0)
 * - Cards cite facts via SupportingRef with explicit roles
 * - Bytewise sorting for stable ordering
 * - Max 5 cards per phase, truncation tracked
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
  suggested_action?: SuggestedAction;
}

export interface ReviewPassEnvelopeV1 {
  review_pass_schema_version: 1;
  phase: ReviewPhase;
  cards: ProposalCardV1[];
  truncated: boolean;
  total_candidates: number;
}
