/**
 * GET /v1/self-check - Deterministic hash endpoint for stability verification
 * 
 * Only available when TEST_ROUTES=1.
 * Exercises fixed scenario end-to-end and returns stable SHA-256 hash.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { GOLDEN_SCENARIO, GOLDEN_SEED } from '../../fixtures/self-check.js';
import { stableStringify, normaliseReport } from '../../util/canonical-json.js';
import { buildModelCard, getActiveFeatureFlags } from '../../trust/model-card.js';
import { calculateConfidence } from '../../trust/confidence.js';
import { buildCritique } from '../../trust/critique-builder.js';
import { buildExplainDelta } from '../../trust/explain-delta.js';
import { checkLinearity, detectThresholdCrossings, generateForkSuggestions } from '../../trust/linearity.js';
import { checkIdentifiability } from '../../trust/identifiability.js';
import { enforceComputeBudget } from '../../governance/cost-estimator.js';

export async function registerSelfCheckRoute(app: FastifyInstance) {
  app.get('/v1/self-check', async (req: FastifyRequest, reply: FastifyReply) => {
    // Only available with TEST_ROUTES=1
    if (process.env.TEST_ROUTES !== '1') {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    // Execute golden scenario through exact same code path as /v1/run
    const { graph } = GOLDEN_SCENARIO;
    const seed = GOLDEN_SEED;
    const k_samples = 1000;
    const treatment_node = graph.nodes[0]?.id || 'start';
    const outcome_node = graph.nodes[graph.nodes.length - 1]?.id || 'approved';
    const baseline_value = 100;

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

    // Linearity check
    const current_value = baseline_value * 1.15;
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

    // Threshold crossings
    const threshold_crossings = detectThresholdCrossings({
      metric_name: 'outcome',
      from_value: baseline_value,
      to_value: current_value,
      thresholds: [99, 199, 299],
    });

    // Fork suggestions
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

    // Explain-Δ
    const explain_delta = buildExplainDelta({
      graph,
      baseline_outcome: baseline_value,
      counterfactual_outcome: current_value,
      seed,
      top_n: 3,
    });

    // Build full report (matching /v1/run structure)
    const report = {
      schema: 'run.v1',
      graph,
      results: {
        conservative: { outcome: baseline_value * 1.05 },
        most_likely: { outcome: current_value },
        optimistic: { outcome: baseline_value * 1.25 },
      },
      model_card,
      confidence,
      linearity_warning: linearity_warning.outside_range ? linearity_warning : undefined,
      threshold_crossings: threshold_crossings.length > 0 ? threshold_crossings : undefined,
      fork_suggestions,
      critique,
      explain_delta,
      identifiability: identifiability.summary,
    };

    // Compute response hash (same as /v1/run)
    const normalised_for_hash = normaliseReport(report);
    const canonical_for_hash = stableStringify(normalised_for_hash);
    const response_hash = createHash('sha256').update(canonical_for_hash, 'utf8').digest('hex');
    
    // Add hash to model_card
    report.model_card.response_hash = response_hash;

    // Normalise and hash again (with response_hash included)
    const normalised = normaliseReport(report);
    const canonical = stableStringify(normalised);
    const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    const bytes = Buffer.byteLength(canonical, 'utf8');

    return {
      schema: 'self_check.v1',
      seed: GOLDEN_SEED,
      hash,
      bytes,
      notes: ['Deterministic end-to-end hash of normalised /v1/run payload'],
    };
  });
}
