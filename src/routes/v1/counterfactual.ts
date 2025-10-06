/**
 * POST /v1/counterfactual - Counterfactual analysis with trust signals
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isDemoMode, getDemoSeed } from '../../middleware/demo-mode.js';
import { getDemoCounterfactualResponse } from '../../fixtures/demo-payloads.js';
import { buildModelCard, getActiveFeatureFlags } from '../../trust/model-card.js';
import { calculateConfidence } from '../../trust/confidence.js';
import { buildExplainDelta } from '../../trust/explain-delta.js';
import { checkIdentifiability } from '../../trust/identifiability.js';
import { enforceComputeBudget } from '../../governance/cost-estimator.js';
import type { Graph } from '../../trust/types.js';

export interface CounterfactualRequest {
  graph: Graph;
  intervention: {
    node_id: string;
    from_value: number;
    to_value: number;
  };
  outcome_node: string;
  seed?: number;
  k_samples?: number;
}

export async function registerCounterfactualRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  
  app.post('/v1/counterfactual', {
    preHandler: createValidator('counterfactual'),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // Demo mode check
    if (isDemoMode(req)) {
      const demo_seed = getDemoSeed(req);
      return getDemoCounterfactualResponse(demo_seed);
    }

    const body = (req as any).body as CounterfactualRequest;

    const {
      graph,
      intervention,
      outcome_node,
      seed = 42,
      k_samples = 1000,
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
      treatment_node: intervention.node_id,
      outcome_node,
    });

    if (!identifiability.identifiable) {
      return reply.code(400).send({
        error: 'NOT_IDENTIFIABLE',
        message: identifiability.notes[0] || 'Counterfactual not identifiable',
        summary: identifiability.summary,
      });
    }

    // Model card
    const model_card = buildModelCard({
      seed,
      assumptions: [
        `Counterfactual intervention on ${intervention.node_id}`,
        'All else held constant (ceteris paribus)',
        'No spillover effects',
        identifiability.summary,
      ],
      k_samples: budget.k,
      downgraded: budget.downgraded,
      downgrade_reason: budget.reason,
      feature_flags: getActiveFeatureFlags(),
    });

    // Confidence badge
    const confidence = calculateConfidence({
      graph,
      identifiable: true,
      in_linear_range: true,
      k_samples: budget.k,
      calibrated: false,
    });

    // Simulate counterfactual results
    const baseline_outcome = intervention.from_value * 100; // Placeholder
    const counterfactual_outcome = intervention.to_value * 95; // Placeholder
    const delta = counterfactual_outcome - baseline_outcome;

    // Zero-baseline guard: if from_value is 0, percentage_change is meaningless
    const warnings: string[] = [];
    let percentage_change: string | null = null;
    
    if (intervention.from_value === 0 || Math.abs(baseline_outcome) < 1e-10) {
      warnings.push('Baseline value is zero - percentage change undefined');
      percentage_change = null;
    } else {
      percentage_change = ((delta / baseline_outcome) * 100).toFixed(2) + '%';
    }

    // Update model_card with warnings if present
    if (warnings.length > 0) {
      model_card.warnings = warnings;
    }

    // Explain-Δ
    const explain_delta = buildExplainDelta({
      graph,
      baseline_outcome,
      counterfactual_outcome,
      seed,
      top_n: 3,
    });

    const results = {
      baseline: { [outcome_node]: baseline_outcome },
      counterfactual: { [outcome_node]: counterfactual_outcome },
      delta: { [outcome_node]: delta },
      percentage_change,
    };

    return {
      schema: 'counterfactual.v1',
      intervention,
      graph,
      results,
      model_card,
      confidence,
      explain_delta,
      identifiability: identifiability.summary,
      adjustment_set: identifiability.adjustment_set,
    };
  });
}
