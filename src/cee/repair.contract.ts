/**
 * Repair Contract (B5.26)
 *
 * Declares which fields may be legitimately dropped (removed) during
 * deterministic sweep processing. Used by contract tests to distinguish
 * intentional field removal from accidental data loss.
 */

/**
 * Fields that the deterministic sweep is allowed to remove from nodes.
 * These live on the node root (not in the data bag).
 */
export const allowedDrops = {
  node: [
    'goal_threshold',
    'goal_threshold_raw',
    'goal_threshold_unit',
    'goal_threshold_direction',
  ],
} as const;
