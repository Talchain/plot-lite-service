/**
 * Review pass module — deterministic review cards from facts and validation.
 *
 * Public API:
 *  - generatePreAnalysisReview()  — violations → cards
 *  - generatePostAnalysisReview() — facts → cards
 *  - containsNumericClaim()       — numeric claim detection
 *  - validateCitations()          — citation validation
 *  - cmp(), sortCards(), cardSortKey(), factSortKey() — deterministic ordering
 *  - Types: ProposalCardV1, ReviewPassEnvelopeV1, Citation, SupportingRef, etc.
 */

export {
  REVIEW_PASS_SCHEMA_VERSION,
  PRIORITY_TO_BAND,
  lookupBand,
  type CitationRole,
  type Citation,
  type FactRef,
  type ViolationRef,
  type SupportingRef,
  type CardType,
  type ReviewPhase,
  type SuggestedAction,
  type PriorityBand,
  type CardProvenance,
  type ProposalCardV1,
  type ReviewPassEnvelopeV1,
} from './types.js';

export {
  generatePreAnalysisReview,
  type ViolationInput,
} from './pre-analysis.js';

export {
  generatePostAnalysisReview,
} from './post-analysis.js';

export {
  containsNumericClaim,
  validateCitations,
} from './numeric-detection.js';

export {
  cmp,
  sortCards,
  cardSortKey,
  factSortKey,
} from './sort.js';
