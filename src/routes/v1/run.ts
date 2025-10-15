/**
 * POST /v1/run - Execute probabilistic model with trust signals
 */

import { createHash, randomUUID } from 'node:crypto';
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
import { runSCMLite } from '../../scm-lite/adapter.js';
import { recordEngineComputeMs } from '../../metrics.js';

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
  const { principalFor, getCached, setCached, pruneExpired } = await import('../../middleware/idempotency.js');
  
  app.post('/v1/run', {
    bodyLimit: 96 * 1024,
    preHandler: [
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Demo mode short-circuit (before Ajv)
        if (isDemoMode(req)) {
          const demo_seed = getDemoSeed(req);
          const payload = getDemoRunResponse(demo_seed) as any;
          if (process.env.TRACE_MIN === '1') {
            try { payload.trace_id = randomUUID(); } catch {}
          }
          return reply.code(200).type('application/json').send(payload);
        }
      },
      // Idempotency replay (before validation)
      async (req: FastifyRequest, reply: FastifyReply) => {
        try { if (Math.random() < 0.01) pruneExpired(); } catch {}
        const idk = String((req.headers as any)['idempotency-key'] || (req.headers as any)['Idempotency-Key'] || '').trim();
        if (!idk) return;
        const principal = principalFor(req);
        const hit = getCached(principal, idk);
        if (hit) {
          try { reply.header('Idempotent-Replayed', '1'); } catch {}
          return reply.code(hit.status).type('application/json').send(hit.body);
        }
        // Mark for onSend storage
        (req as any).__idemp = { principal, idk };
      },
      createValidator('run'),
    ],
    onSend: [
      async (req: FastifyRequest, reply: FastifyReply, payload: any) => {
        try {
          const marker = (req as any).__idemp;
          if (!marker) return payload;
          // Only store JSON bodies
          let body: any = payload;
          if (typeof payload === 'string') {
            try { body = JSON.parse(payload); } catch { body = null; }
          }
          if (body && typeof body === 'object') {
            const status = reply.statusCode || 200;
            setCached(marker.principal, marker.idk, status, body);
            try { reply.header('Idempotent-Replayed', '0'); } catch {}
          }
          return payload;
        } catch {
          return payload;
        }
      },
    ],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // (demo handled in preHandler)
    const computeStart = performance.now();

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

    // Identifiability tag (flag-gated)
    if (process.env.IDENT_TAG_ENABLE === '1') {
      const { generateIdentifiabilityTag } = await import('../../trust/identifiability-tag.js');
      model_card.identifiability_tag = generateIdentifiabilityTag({
        identifiable: identifiability.identifiable,
        has_backdoor_paths: identifiability.adjustment_set.length > 0,
        adjustment_set_size: identifiability.adjustment_set.length,
      });
    }

    // Linearity check (placeholder - would use actual run results)
    const current_value = baseline_value * 1.15; // Simulated
    const linearity_warning = checkLinearity({
      baseline_value,
      current_value,
      linear_range_percent: 20,
    });

    // Confidence badge (may be overridden by SCM-Lite)
    let confidence = calculateConfidence({
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

    // Execute SCM-Lite kernel if enabled, otherwise simulate
    let results: any;
    let scm_bma_hash: string | undefined;
    
    if (process.env.SCM_LITE_ENABLE === '1') {
      const scmConfig = {
        seed,
        K: Number(process.env.SCM_LITE_K || 256),
        maxNodes: Number(process.env.SCM_LITE_MAX_NODES || 12),
        beliefDefault: Number(process.env.SCM_LITE_BELIEF_DEFAULT || 0.7),
      };
      
      const scmResult = runSCMLite(graph, outcome_node, scmConfig);
      
      // Map SCM quantiles to results format
      results = {
        conservative: { outcome: scmResult.summary.bands.p10 },
        most_likely: { outcome: scmResult.summary.bands.p50 },
        optimistic: { outcome: scmResult.summary.bands.p90 },
      };
      
      scm_bma_hash = scmResult.bma_hash;
      
      // Override confidence with SCM result
      const scmLevelMap: Record<string, number> = { low: 0.3, medium: 0.6, high: 0.9 };
      confidence = {
        level: scmResult.confidence.toUpperCase() as any,
        reason: `SCM-Lite kernel (K=${scmConfig.K}, unique_graphs=${scmResult.meta.unique_graphs})`,
        score: scmLevelMap[scmResult.confidence] || 0.5,
        factors: {
          identifiability: identifiability.identifiable ? 1.0 : 0.3,
          linearity_distance: 1.0,
          k_coverage: Math.min(scmConfig.K / 1000, 1.0),
          calibration: scmResult.meta.sign_stability,
        },
      };
    } else {
      // Warn in production when SCM-Lite is disabled
      if (process.env.NODE_ENV === 'production') {
        app.log.warn({ feature: 'scm_lite', enabled: false }, 'SCM_LITE disabled — using placeholder results');
      }
      
      // Simulate results (placeholder - real implementation would run inference)
      results = {
        conservative: { outcome: baseline_value * 1.05 },
        most_likely: { outcome: current_value },
        optimistic: { outcome: baseline_value * 1.25 },
      };
    }

    // Build response with meta in alphabetical position
    const base: any = {
      confidence,
      critique,
      explain_delta,
      graph,
      identifiability: identifiability.summary,
      meta: {
        seed,
        commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
        version: '1.0.0',
      },
      model_card,
      results,
      schema: 'run.v1',
    };
    // Compute response hash (SHA-256 of normalised payload)
    const normalised = normaliseReport(base);
    const canonical = stableStringify(normalised);
    const response_hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
    base.model_card.response_hash = response_hash;
    
    // Add BMA hash if SCM-Lite was used
    if (scm_bma_hash) {
      base.model_card.bma_hash = scm_bma_hash;
    }
    // Optional trace_id (not included in response_hash)
    if (process.env.TRACE_MIN === '1') {
      base.trace_id = randomUUID();
    }
    
    // Record compute time for observability
    const computeMs = performance.now() - computeStart;
    recordEngineComputeMs(computeMs);
    
    return base;
  });
}
