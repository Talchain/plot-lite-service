/**
 * DriversPayload Builder
 *
 * Transforms existing sensitivity outputs into structured DriversPayload.
 * Ensures drivers are never silently empty after a successful run.
 */

import type { SensitivityEdge } from '../lib/sensitivity-simple.js';
import type {
  DriversPayload,
  DriverItem,
  DriversStatus,
  RemediationAction,
  DiscriminationSignal,
} from '../types/drivers.js';

/**
 * Threshold below which sensitivity scores are considered "flat" (low discrimination)
 */
const LOW_DISCRIMINATION_THRESHOLD = 0.05;

/**
 * Threshold for quantile spread (p90 - p10) below which outcomes are flat
 */
const QUANTILE_SPREAD_THRESHOLD = 0.05;

/**
 * Transform SensitivityEdge to DriverItem
 */
function edgeToDriverItem(edge: SensitivityEdge): DriverItem {
  const sensitivityScore = edge.sensitivity ?? edge.score;
  return {
    // Required fields (UI contract)
    id: edge.edge_id,
    impact: sensitivityScore,
    direction: edge.weight >= 0 ? 'positive' : 'negative',
    // Optional extras (backward compatibility)
    kind: 'edge',
    label: `${edge.from} → ${edge.to}`,
    sensitivity_score: sensitivityScore,
    details: edge.provenance !== 'template' ? edge.provenance : undefined,
  };
}

/**
 * Check if sensitivities are flat (all scores below threshold or too similar)
 */
function areSensitivitiesFlat(edges: SensitivityEdge[]): boolean {
  if (edges.length === 0) return true;

  const scores = edges.map(e => e.sensitivity ?? e.score);
  const maxScore = Math.max(...scores);

  // All scores are very low
  if (maxScore < LOW_DISCRIMINATION_THRESHOLD) return true;

  // Check if scores are too similar (low variance)
  if (scores.length > 1) {
    const minScore = Math.min(...scores);
    const range = maxScore - minScore;
    // If all scores are within 5% of each other, they're flat
    if (range < LOW_DISCRIMINATION_THRESHOLD) return true;
  }

  return false;
}

/**
 * Build DriversPayload from sensitivity edges
 *
 * @param edges - Sensitivity edges from computeSensitivitySimple/computeSensitivityAll
 * @param computationSucceeded - Whether the underlying inference succeeded
 * @param computationError - Error message if computation failed
 */
export function buildDriversPayload(
  edges: SensitivityEdge[] | undefined,
  computationSucceeded: boolean = true,
  computationError?: string
): DriversPayload {
  // Case 1: Computation failed
  if (!computationSucceeded || computationError) {
    return {
      status: 'cannot_compute',
      status_reason: computationError || 'Inference computation failed',
      informative: false,
      remediation_actions: [
        {
          code: 'retry_run',
          label: 'Retry the analysis',
        },
        {
          code: 'check_graph',
          label: 'Verify graph structure is valid',
        },
      ],
    };
  }

  // Case 2: No edges (shouldn't happen after successful run, but handle gracefully)
  if (!edges || edges.length === 0) {
    return {
      status: 'cannot_compute',
      status_reason: 'No edges available for sensitivity analysis',
      informative: false,
      remediation_actions: [
        {
          code: 'add_edges',
          label: 'Add edges to connect decision to outcome',
        },
      ],
    };
  }

  // Transform edges to driver items
  const drivers = edges.map(edgeToDriverItem);

  // Case 3: Sensitivities are flat (low discrimination)
  if (areSensitivitiesFlat(edges)) {
    return {
      status: 'low_discrimination',
      status_reason: 'Edge sensitivities are similar - outcomes may not differentiate well between options',
      informative: false,
      drivers,
      remediation_actions: [
        {
          code: 'refine_edge_weights',
          label: 'Adjust edge weights to reflect different strengths',
        },
        {
          code: 'add_evidence',
          label: 'Add evidence to differentiate edge impacts',
        },
      ],
    };
  }

  // Case 4: Success - informative drivers
  return {
    status: 'ok',
    informative: true,
    drivers,
  };
}

/**
 * Build DiscriminationSignal from outcome bands
 *
 * @param p10 - 10th percentile outcome
 * @param p50 - 50th percentile outcome (median)
 * @param p90 - 90th percentile outcome
 * @param baseline - Baseline value for normalization
 */
export function buildDiscriminationSignal(
  p10: number,
  p50: number,
  p90: number,
  baseline: number = 100
): DiscriminationSignal {
  // Calculate quantile spread (normalized by baseline if non-zero)
  const spread = p90 - p10;
  const normalizedSpread = baseline !== 0 ? Math.abs(spread / baseline) : spread;

  const isLowDiscrimination = normalizedSpread < QUANTILE_SPREAD_THRESHOLD;

  if (isLowDiscrimination) {
    return {
      status: 'low_discrimination',
      metric: 'quantile_spread',
      value: normalizedSpread,
      threshold: QUANTILE_SPREAD_THRESHOLD,
      remediation_actions: [
        {
          code: 'increase_variance',
          label: 'Increase variability in edge weights or beliefs',
        },
        {
          code: 'differentiate_options',
          label: 'Ensure options have distinct effects on outcomes',
        },
      ],
    };
  }

  return {
    status: 'ok',
    metric: 'quantile_spread',
    value: normalizedSpread,
    threshold: QUANTILE_SPREAD_THRESHOLD,
  };
}

/**
 * Merge DriversPayload with DiscriminationSignal
 * If discrimination is low, it may override an 'ok' status
 */
export function applyDiscriminationToDrivers(
  driversPayload: DriversPayload,
  discrimination: DiscriminationSignal
): DriversPayload {
  // If drivers already not ok, keep that status
  if (driversPayload.status !== 'ok') {
    return driversPayload;
  }

  // If discrimination is low, downgrade drivers status
  if (discrimination.status === 'low_discrimination') {
    return {
      ...driversPayload,
      status: 'low_discrimination',
      status_reason: 'Outcome spread is narrow - options may not differentiate well',
      informative: false,
      remediation_actions: discrimination.remediation_actions,
    };
  }

  return driversPayload;
}
