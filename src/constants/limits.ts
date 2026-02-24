/**
 * Graph Limits - Single Source of Truth
 *
 * All limit enforcement across V1 and V2 must import from this file.
 * Canonical values are now defined in @talchain/schemas.
 *
 * @see P0-PLOT: Unified graph limits
 */

// CIL Phase 1: LIMITS imported from shared schema package
import { LIMITS } from '@talchain/schemas';
export { LIMITS };

// Verified 24 Feb 2026: V1 and V2 routes all enforce these limits consistently.
// Source of truth: @talchain/schemas. See Decision Model Schema §D.1.
// Internal validation layer (VALIDATION_MAX_NODES/EDGES) uses more permissive
// values for non-SCM inference modes — these are NOT exposed via public API.

// Re-export individual constants for backwards compatibility
export const MAX_NODES = LIMITS.MAX_NODES;
export const MAX_EDGES = LIMITS.MAX_EDGES;
export const MAX_OPTIONS = LIMITS.MAX_OPTIONS;

// CIL M5: Named constant for default edge exists_probability.
// Not yet available in @talchain/schemas; defined here as single source of truth.
export const DEFAULT_EXISTS_PROBABILITY = 0.8;
