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

// Re-export individual constants for backwards compatibility
export const MAX_NODES = LIMITS.MAX_NODES;
export const MAX_EDGES = LIMITS.MAX_EDGES;
export const MAX_OPTIONS = LIMITS.MAX_OPTIONS;
