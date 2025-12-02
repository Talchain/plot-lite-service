/**
 * Change Attribution Types
 *
 * Provides causal attribution for outcome changes in scenario comparisons,
 * mapping structural graph differences to their estimated impact on outcomes.
 */

/**
 * Type of structural change in the graph
 */
export type ChangeType =
  | 'edge_added'
  | 'edge_removed'
  | 'edge_weight_changed'
  | 'node_value_changed'
  | 'node_added'
  | 'node_removed';

/**
 * Node affected by a change
 */
export interface AffectedNode {
  id: string;
  label: string;
}

/**
 * Individual change that contributed to outcome delta
 */
export interface ChangeDriver {
  /** Type of change that occurred */
  change_type: ChangeType;

  /** Human-readable description of the change */
  description: string;

  /** Estimated contribution to outcome delta (signed) */
  contribution_to_delta: number;

  /** Percentage contribution to total absolute change (0-100) */
  contribution_pct: number;

  /** Nodes affected by this change */
  affected_nodes: AffectedNode[];

  /** Before value for weight/value changes */
  before_value?: number;

  /** After value for weight/value changes */
  after_value?: number;
}

/**
 * Complete attribution of outcome change
 */
export interface ChangeAttribution {
  /** Total outcome delta (comparison - baseline) */
  outcome_delta: number;

  /** Top drivers of change (up to 5) */
  primary_drivers: ChangeDriver[];

  /** Human-readable summary */
  summary: string;
}
