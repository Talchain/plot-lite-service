/**
 * DSK (Deterministic Science Knowledge Base) — Type definitions
 *
 * All DSK objects share a common base and are discriminated by `type`.
 * The bundle is a versioned, hashed collection of DSK objects.
 */

// ── Enums / unions ──────────────────────────────────────────────────

export type DecisionStage = 'frame' | 'ideate' | 'evaluate' | 'decide' | 'optimise';

export const DECISION_STAGES: readonly DecisionStage[] = [
  'frame', 'ideate', 'evaluate', 'decide', 'optimise',
] as const;

export const CONTEXT_TAGS_VOCABULARY: readonly string[] = [
  'pricing', 'hiring', 'build_vs_buy', 'market_entry', 'resource_allocation', 'general',
] as const;

// ── Shared interfaces ───────────────────────────────────────────────

export interface Citation {
  doi_or_isbn: string;
  page_or_section: string;
}

export interface ClaimReference {
  claim_id: string;
  claim_version: string;
}

// ── Base ─────────────────────────────────────────────────────────────

export interface DSKObjectBase {
  id: string;                              // immutable, format: /^DSK-(B|T|TR)\d{3}$/
  type: 'claim' | 'protocol' | 'trigger';
  title: string;
  evidence_strength: 'strong' | 'medium' | 'weak' | 'mixed';
  contraindications: string[];
  stage_applicability: DecisionStage[];
  context_tags: string[];
  version: string;                         // semver e.g. '1.0.0'
  last_reviewed_at: string;                // ISO 8601 date
  source_citations: Citation[];            // at least one required
  deprecated: boolean;
  deprecated_reason?: string;
  replacement_id?: string;                 // must reference a non-deprecated object of the SAME type
}

// ── Claim ────────────────────────────────────────────────────────────

export interface DSKClaim extends DSKObjectBase {
  type: 'claim';
  claim_category: 'empirical' | 'technique_efficacy' | 'causal_rule' | 'population';
  scope: {
    decision_contexts: string[];           // at least one required
    stages: DecisionStage[];               // at least one required
    populations: string[];                 // at least one required
    exclusions: string[];                  // at least one required
  };
  permitted_phrasing_band: 'strong' | 'medium' | 'weak';
  evidence_pack: {
    key_findings: string;
    effect_direction: 'positive' | 'negative' | 'mixed' | 'null';
    boundary_conditions: string;
    known_limitations: string;
  };
}

// ── Protocol ─────────────────────────────────────────────────────────

export interface DSKProtocol extends DSKObjectBase {
  type: 'protocol';
  steps: string[];                         // at least one required
  required_inputs: string[];
  expected_outputs: string[];
}

// ── Trigger ──────────────────────────────────────────────────────────

export interface DSKTrigger extends DSKObjectBase {
  type: 'trigger';
  observable_signal: string;
  recommended_behaviour: string;
  negative_conditions: string[];           // at least one required
  linked_claim_ids: string[];
  linked_protocol_ids: string[];
}

// ── Discriminated union ──────────────────────────────────────────────

export type DSKObject = DSKClaim | DSKProtocol | DSKTrigger;

// ── Bundle ───────────────────────────────────────────────────────────

export interface DSKBundle {
  version: string;                         // bundle semver
  generated_at: string;                    // ISO 8601 (metadata only — excluded from hash)
  dsk_version_hash: string;                // canonical hash (computed by tooling, verified at load)
  objects: DSKObject[];
}
