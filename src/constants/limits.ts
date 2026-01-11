/**
 * Graph Limits - Single Source of Truth
 *
 * All limit enforcement across V1 and V2 must import from this file.
 * Do not define limit values elsewhere.
 *
 * @see P0-PLOT: Unified graph limits
 */

/**
 * Canonical graph and option limits.
 * These values are enforced at all API boundaries.
 */
export const LIMITS = {
  /** Maximum nodes allowed in a graph */
  MAX_NODES: 50,

  /** Maximum edges allowed in a graph */
  MAX_EDGES: 100,

  /** Maximum options allowed for comparison */
  MAX_OPTIONS: 10,
} as const;

// Re-export individual constants for backwards compatibility
export const MAX_NODES = LIMITS.MAX_NODES;
export const MAX_EDGES = LIMITS.MAX_EDGES;
export const MAX_OPTIONS = LIMITS.MAX_OPTIONS;
