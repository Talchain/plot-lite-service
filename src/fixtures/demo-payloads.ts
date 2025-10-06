/**
 * Demo Mode - Deterministic Sample Payloads
 * For UI development and showcasing rich panels
 */

import type { TrustedResponse, Graph } from '../trust/types.js';
import { buildModelCard } from '../trust/model-card.js';
import { calculateConfidence } from '../trust/confidence.js';
import { buildCritique } from '../trust/critique-builder.js';
import { buildExplainDelta } from '../trust/explain-delta.js';
import { checkLinearity, detectThresholdCrossings, generateForkSuggestions } from '../trust/linearity.js';

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
    calibrated: false,
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

  return {
    schema: 'report.v1',
    graph,
    results: {
      conservative: { revenue: 10500, ltv: 450 },
      most_likely: { revenue: 11500, ltv: 480 },
      optimistic: { revenue: 12800, ltv: 520 },
    },
    model_card,
    confidence,
    linearity_warning,
    threshold_crossings,
    fork_suggestions,
    critique,
    explain_delta,
  };
}

/**
 * Demo /v1/counterfactual response
 */
export function getDemoCounterfactualResponse(seed: number = 42): any {
  const graph = getDemoPricingGraph();
  
  const model_card = buildModelCard({
    seed,
    assumptions: [
      'Counterfactual intervention on price node',
      'All else held constant (ceteris paribus)',
      'No spillover effects',
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

  const explain_delta = buildExplainDelta({
    graph,
    baseline_outcome: 11500,
    counterfactual_outcome: 10200,
    seed,
    node_sensitivities: new Map([
      ['price', -0.5],
      ['demand', 0.4],
      ['revenue', -0.55],
    ]),
    top_n: 3,
  });

  return {
    schema: 'counterfactual.v1',
    intervention: {
      node: 'price',
      from_value: 129,
      to_value: 99,
    },
    graph,
    results: {
      baseline: { revenue: 11500, ltv: 480 },
      counterfactual: { revenue: 10200, ltv: 510 },
      delta: { revenue: -1300, ltv: 30 },
    },
    model_card,
    confidence,
    explain_delta,
  };
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

  return {
    schema: 'critique.v1',
    graph,
    critique,
    model_card,
    fix_applied: [],
  };
}
