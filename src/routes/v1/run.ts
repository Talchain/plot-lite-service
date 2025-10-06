/**
 * POST /v1/run - Execute probabilistic model with trust signals
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isDemoMode, getDemoSeed } from '../../middleware/demo-mode.js';
import { getDemoRunResponse } from '../../fixtures/demo-payloads.js';
import { buildModelCard, getActiveFeatureFlags } from '../../trust/model-card.js';
import { calculateConfidence } from '../../trust/confidence.js';
import { buildCritique } from '../../trust/critique-builder.js';
import { buildExplainDelta } from '../../trust/explain-delta.js';
import { checkLinearity, detectThresholdCrossings, generateForkSuggestions } from '../../trust/linearity.js';
import { checkIdentifiability } from '../../trust/identifiability.js';
import { enforceComputeBudget } from '../../governance/cost-estimator.js';
import { stableStringify, normaliseReport } from '../../util/canonical-json.js';
import type { Graph } from '../../trust/types.js';

export interface RunRequest {
  graph: Graph;
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
}

export async function registerRunRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  
  app.post('/v1/run', {
    preHandler: createValidator('run'),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // Demo mode check
    if (isDemoMode(req)) {
      const demo_seed = getDemoSeed(req);
      return getDemoRunResponse(demo_seed);
    }

    const body = (req as any).body as RunRequest;

    const {
      graph,
      seed = 42,
      k_samples = 1000,
      treatment_node = graph.nodes[0]?.id,
      outcome_node = graph.nodes[graph.nodes.length - 1]?.id,
      baseline_value = 100,
    } = body;

    // Cost governance
    const budget = enforceComputeBudget({
      graph,
      requested_k: k_samples,
      soft_cap_k: 5000,
      max_compute_ms: 30000,
    });

    // Identifiability check
    const identifiability = checkIdentifiability({
      graph,
      treatment_node,
      outcome_node,
    });

    // Model card
    const model_card = buildModelCard({
      seed,
      assumptions: [
        'Linear response within ±20% of baseline',
        'Independent observations',
        identifiability.summary,
      ],
      k_samples: budget.k,
      downgraded: budget.downgraded,
      downgrade_reason: budget.reason,
      feature_flags: getActiveFeatureFlags(),
    });

    // Linearity check (placeholder - would use actual run results)
    const current_value = baseline_value * 1.15; // Simulated
    const linearity_warning = checkLinearity({
      baseline_value,
      current_value,
      linear_range_percent: 20,
    });

    // Confidence badge
    const confidence = calculateConfidence({
      graph,
      identifiable: identifiability.identifiable,
      in_linear_range: !linearity_warning.outside_range,
      k_samples: budget.k,
      calibrated: false,
    });

    // Threshold crossings (example with price thresholds)
    const threshold_crossings = detectThresholdCrossings({
      metric_name: 'outcome',
      from_value: baseline_value,
      to_value: current_value,
      thresholds: [99, 199, 299],
    });

    // Fork suggestions if threshold crossed
    const fork_suggestions = threshold_crossings.length > 0
      ? generateForkSuggestions({
          metric_name: 'outcome',
          current_value,
          threshold: threshold_crossings[0].threshold,
          direction: threshold_crossings[0].direction,
        })
      : undefined;

    // Critique
    const critique = buildCritique({
      graph,
      assumptions: model_card.assumptions_summary,
      identifiable: identifiability.identifiable,
      node_limit: 12,
    });

    // Explain-Δ (deterministic with seed)
    const explain_delta = buildExplainDelta({
      graph,
      baseline_outcome: baseline_value,
      counterfactual_outcome: current_value,
      seed,
      top_n: 3,
    });

    // Simulate results (placeholder - real implementation would run inference)
    const results = {
      conservative: { outcome: baseline_value * 1.05 },
      most_likely: { outcome: current_value },
      optimistic: { outcome: baseline_value * 1.25 },
    };

    // Build initial response (without hash)
    const response = {
      schema: 'run.v1',
      meta: {
        seed,
        commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
        version: '1.0.0',
      },
      graph,
      results,
      model_card,
      confidence,
      linearity_warning: linearity_warning.outside_range ? linearity_warning : undefined,
      threshold_crossings: threshold_crossings.length > 0 ? threshold_crossings : undefined,
      fork_suggestions,
      critique,
      explain_delta,
      identifiability: identifiability.summary,
    };

    // Compute response hash (SHA-256 of normalised payload)
    const normalised = normaliseReport(response);
    const canonical = stableStringify(normalised);
    const response_hash = createHash('sha256').update(canonical, 'utf8').digest('hex');

    // Add hash to model_card for auditability
    response.model_card.response_hash = response_hash;

    return response;
  });
}
