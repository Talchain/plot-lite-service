/**
 * Demo Mode - Deterministic Sample Payloads
 * For UI development and showcasing rich panels
 */

import type { Graph } from '../trust/types.js';
import { buildModelCard } from '../trust/model-card.js';
import { stampResponseHash } from '../util/canonical-json.js';
import { calculateConfidence } from '../trust/confidence.js';
import { buildCritique } from '../trust/critique-builder.js';
import { buildExplainDelta } from '../trust/explain-delta.js';
import { checkLinearity, detectThresholdCrossings, generateForkSuggestions } from '../trust/linearity.js';
import { computeSensitivitySimple } from '../lib/sensitivity-simple.js';
import { buildDriversPayload, buildDiscriminationSignal, applyDiscriminationToDrivers } from '../trust/drivers-builder.js';

/**
 * Demo graph: Pricing Change scenario
 */
function getDemoPricingGraph(): Graph {
  return {
    nodes: [
      { id: 'price', label: 'New Price' },
      { id: 'demand', label: 'Demand' },
      { id: 'revenue', label: 'Revenue' },
      { id: 'competitor', label: 'Competitor Response' },
      { id: 'churn', label: 'Churn Rate' },
      { id: 'ltv', label: 'Customer LTV' },
    ],
    edges: [
      { from: 'price', to: 'demand', weight: 0.8 },
      { from: 'price', to: 'churn', weight: 0.6 },
      { from: 'demand', to: 'revenue', weight: 0.9 },
      { from: 'competitor', to: 'demand', weight: 0.7 },
      { from: 'churn', to: 'ltv', weight: 0.85 },
      { from: 'revenue', to: 'ltv', weight: 0.75 },
    ],
  };
}

/**
 * Demo /v1/run response
 */
export function getDemoRunResponse(seed: number = 42): any {
  const graph = getDemoPricingGraph();
  
  const model_card = buildModelCard({
    seed,
    assumptions: [
      'Price elasticity constant within ±20% range',
      'Competitor response within 2 weeks',
      'No external market shocks',
    ],
    k_samples: 1000,
    feature_flags: { DEMO_MODE: true },
  });

  const confidence = calculateConfidence({
    graph,
    identifiable: true,
    in_linear_range: true,
    k_samples: 1000,
  });

  const linearity_warning = checkLinearity({
    baseline_value: 99,
    current_value: 129,
    linear_range_percent: 20,
  });

  const threshold_crossings = detectThresholdCrossings({
    metric_name: 'price',
    from_value: 99,
    to_value: 129,
    thresholds: [99, 199],
  });

  const fork_suggestions = threshold_crossings.length > 0
    ? generateForkSuggestions({
        metric_name: 'price',
        current_value: 129,
        threshold: 99,
        direction: 'up',
      })
    : undefined;

  const critique = buildCritique({
    graph,
    assumptions: model_card.assumptions_summary,
    identifiable: true,
    node_limit: 12,
  });

  const explain_delta = buildExplainDelta({
    graph,
    baseline_outcome: 10000,
    counterfactual_outcome: 11500,
    seed,
    node_sensitivities: new Map([
      ['price', 0.45],
      ['demand', -0.35],
      ['revenue', 0.6],
      ['competitor', -0.2],
      ['churn', -0.15],
      ['ltv', 0.25],
    ]),
    top_n: 3,
  });

  // P0: Compute top edge drivers for "Why this recommendation?" section
  const top_edge_drivers = computeSensitivitySimple(graph.edges, 'ltv');

  // P0: Build DriversPayload with explicit status handling
  const driversPayloadRaw = buildDriversPayload(top_edge_drivers, true);
  const discrimination = buildDiscriminationSignal(10500, 11500, 12800, 10000);
  const drivers_payload = applyDiscriminationToDrivers(driversPayloadRaw, discrimination);

  const report = {
    schema: 'run.v1',
    // P0: request_id always present in demo response
    request_id: `demo-${seed}`,
    meta: {
      seed,
      commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
      version: '1.0.0',
    },
    graph,
    results: {
      conservative: { outcome: 10500 },
      most_likely: { outcome: 11500 },
      optimistic: { outcome: 12800 },
    },
    model_card,
    confidence,
    linearity_warning,
    threshold_crossings,
    fork_suggestions,
    critique,
    // P0: Discrimination signal for low-variance outcomes
    discrimination,
    // P0: Structured drivers payload with explicit status handling
    drivers_payload,
    explain_delta: { ...explain_delta, top_edge_drivers },
  } as any;
  return stampResponseHash(report);
}

/**
 * Demo /v1/critique response
 */
export function getDemoCritiqueResponse(seed: number = 42): any {
  const graph = getDemoPricingGraph();
  
  const model_card = buildModelCard({
    seed,
    assumptions: [],
    feature_flags: { DEMO_MODE: true },
  });

  const critique = buildCritique({
    graph,
    assumptions: [],
    identifiable: true,
    node_limit: 12,
  });

  const doc = {
    schema: 'critique.v1',
    graph,
    critique,
    model_card,
    fix_applied: [],
  } as any;
  return stampResponseHash(doc);
}
