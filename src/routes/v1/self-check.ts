/**
 * GET /v1/self-check - Deterministic hash endpoint for stability verification
 * 
 * Only available when TEST_ROUTES=1.
 * Exercises fixed scenario end-to-end and returns stable SHA-256 hash.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GOLDEN_SCENARIO, GOLDEN_SEED } from '../../fixtures/self-check.js';
import { stableStringify, normaliseReport, stampResponseHash, sha256Stable } from '../../util/canonical-json.js';
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

    // Build full report (matching /v1/run structure) and stamp response hash
    const report = stampResponseHash({
      schema: 'run.v1',
      meta: {
        seed,
        commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
        version: '1.0.0',
      },
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
    } as any);

    // Use the response_hash that was already computed by stampResponseHash
    const hash = (report as any).model_card.response_hash;
    const canonical = stableStringify(normaliseReport(report));
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
