/**
 * Key Drivers Types
 *
 * Structured payload for driver analysis with explicit status handling.
 * Guarantees drivers are never silently empty after a successful run.
 */

/**
 * Status of driver computation
 * - 'ok': Drivers computed successfully and are informative
 * - 'cannot_compute': Drivers genuinely unavailable (inference failed, malformed graph)
 * - 'requires_run': Drivers need a run to be computed first
 * - 'low_discrimination': Drivers computable but sensitivities are flat/uninformative
 */
export type DriversStatus = 'ok' | 'cannot_compute' | 'requires_run' | 'low_discrimination';

/**
 * Single driver item (edge or node that influences outcome)
 */
export interface DriverItem {
  /** Stable identifier (edge_id for edges, node_id for nodes) */
  id: string;
  /** Type of driver */
  kind: 'edge' | 'node';
  /** UI-ready label */
  label: string;
  /** Sensitivity score (0-1 typically) */
  sensitivity_score?: number;
  /** Optional short explanation */
  details?: string;
}

/**
 * Actionable remediation hint for UI
 */
export interface RemediationAction {
  /** Machine-readable code (e.g., 'refine_edge_weights', 'add_evidence') */
  code: string;
  /** Human-readable label for UI */
  label: string;
  /** Target node/edge IDs if applicable */
  target_ids?: string[];
}

/**
 * Structured drivers payload with explicit status handling
 *
 * Behaviour guarantees:
 * 1. If /v1/run succeeds, DriversPayload MUST be present
 * 2. status='ok' with informative=true → drivers.length > 0
 * 3. status='low_discrimination' → drivers still populated + warning
 * 4. status='cannot_compute' or 'requires_run' → status_reason + remediation_actions
 */
export interface DriversPayload {
  /** Computation status */
  status: DriversStatus;
  /** Human-readable reason when status !== 'ok' */
  status_reason?: string;
  /** Machine-actionable hints for non-ok states */
  remediation_actions?: RemediationAction[];
  /** Driver items (present when status='ok' or 'low_discrimination') */
  drivers?: DriverItem[];
  /** False if drivers exist but are not meaningful (e.g., flat sensitivities) */
  informative: boolean;
}

/**
 * Low discrimination signal with deterministic metric
 */
export interface DiscriminationSignal {
  /** Whether outcomes discriminate meaningfully */
  status: 'ok' | 'low_discrimination';
  /** Metric used for detection */
  metric: 'quantile_spread' | 'expected_value_delta' | 'hhi_concentration';
  /** Computed metric value */
  value: number;
  /** Threshold used for comparison */
  threshold: number;
  /** Option IDs affected by low discrimination */
  affected_option_ids?: string[];
  /** Remediation suggestions */
  remediation_actions?: RemediationAction[];
}
