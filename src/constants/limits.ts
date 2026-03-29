/**
 * Graph Limits - Single Source of Truth
 *
 * All limit enforcement across V1 and V2 must import from this file.
 * Canonical values are now defined in @talchain/schemas.
 *
 * @see P0-PLOT: Unified graph limits
 */

// CIL Phase 1: LIMITS imported from shared schema package
import { LIMITS, DEFAULT_EXISTS_PROBABILITY } from '@talchain/schemas';
export { LIMITS, DEFAULT_EXISTS_PROBABILITY };

// Verified 24 Feb 2026: V1 and V2 routes all enforce these canonical limits.
// Source of truth: @talchain/schemas. See Decision Model Schema §D.1.
//
// Note: src/config/constants.ts re-exports these as LIMITS_MAX_NODES/EDGES
// with env-override support (GRAPH_MAX_NODES/GRAPH_MAX_EDGES), but values
// are capped at these canonical maximums via Math.min(). Env overrides can
// only make limits stricter, never more permissive.
//
// Internal validation layer (VALIDATION_MAX_NODES/EDGES at 200/500) uses
// more permissive values for non-SCM inference modes — NOT exposed via
// public API endpoints.

// Re-export individual constants for backwards compatibility
export const MAX_NODES = LIMITS.MAX_NODES;
export const MAX_EDGES = LIMITS.MAX_EDGES;
export const MAX_OPTIONS = LIMITS.MAX_OPTIONS;

// CIL M5: Named constant for default edge exists_probability.
// Canonical source: @talchain/schemas (re-exported above).

// P.8: Maximum goal_constraints per request. Enforced on raw input count before
// any compilation or filtering. DoS protection — ISL evaluates each constraint
// via Monte Carlo; unbounded constraint arrays are a latent DoS vector.
// MAX_CONSTRAINTS enforced on raw input count. Temporal filtering may reduce the
// count further, but the limit applies before any compilation or filtering.
export const MAX_CONSTRAINTS = 20;
