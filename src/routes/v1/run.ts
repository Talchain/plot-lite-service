/**
 * POST /v1/run - Execute probabilistic model with trust signals
 */

import { randomUUID } from 'node:crypto';
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
import { stampResponseHash, hashCanonicalInput } from '../../util/canonical-json.js';
import type { Graph } from '../../trust/types.js';
import { runSCMLite } from '../../scm-lite/adapter.js';
import { getInferenceEngine, type InferenceMode } from '../../inference/index.js';
import { computeSensitivitySimple } from '../../lib/sensitivity-simple.js';
import { recordEngineComputeMs } from '../../metrics.js';
import { runResponseSchema } from '../../schemas/response.js';


export interface RunRequest {
  graph: Graph;
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
  inference_mode?: InferenceMode;
  include_debug?: boolean;
}

export async function registerRunRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  const { principalFor, getCached, setCached, pruneExpired } = await import('../../middleware/idempotency.js');
  
  app.post('/v1/run', {
    schema: {
      body: {
        type: 'object',
        required: ['graph'],
        properties: {
          graph: { type: 'object' },
          seed: { type: 'number' },
          k_samples: { type: 'number' },
          treatment_node: { type: 'string' },
          outcome_node: { type: 'string' },
          baseline_value: { type: 'number' },
          query: { type: 'object' },
          inference_mode: { type: 'string', enum: ['model_based', 'model_of_inference'] },
          include_debug: { type: 'boolean' }
        },
        additionalProperties: true
      },
      response: { 200: runResponseSchema }
    },
    attachValidation: true,  // Attach validation errors to request instead of auto-failing
    bodyLimit: 96 * 1024,
    preHandler: [
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Demo mode short-circuit (before validation check)
        if (isDemoMode(req)) {
          const demo_seed = getDemoSeed(req);
          const payload = getDemoRunResponse(demo_seed) as any;
          if (process.env.TRACE_MIN === '1') {
            try { payload.trace_id = randomUUID(); } catch {}
          }
          return reply.code(200).type('application/json').send(payload);
        }
        
        // Check validation errors (only for non-demo requests)
        if ((req as any).validationError) {
          const err = (req as any).validationError;
          throw err;  // Let global error handler format it
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
      inference_mode = 'model_based',
      include_debug = false,
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

    // Execute inference using selected mode
    const inferenceEngine = getInferenceEngine(inference_mode);
    let results: any;
    let scm_bma_hash: string | undefined;
    
    try {
      const inferenceResult = await inferenceEngine.run(graph, {
        seed,
        k_samples,
        outcome_node,
        baseline_value,
      });
      
      results = {
        conservative: inferenceResult.conservative,
        most_likely: inferenceResult.most_likely,
        optimistic: inferenceResult.optimistic,
      };
      
      scm_bma_hash = inferenceResult.meta?.bma_hash;
      
      // Update confidence if SCM meta available
      if (inferenceResult.meta?.unique_graphs) {
        const scmLevelMap: Record<string, number> = { low: 0.3, medium: 0.6, high: 0.9 };
        confidence = {
          level: 'MEDIUM' as any,
          reason: `${inferenceEngine.name} (K=${k_samples}, unique_graphs=${inferenceResult.meta.unique_graphs})`,
          score: 0.6,
          factors: {
            identifiability: identifiability.identifiable ? 1.0 : 0.3,
            linearity_distance: 1.0,
            k_coverage: Math.min(k_samples / 1000, 1.0),
            calibration: inferenceResult.meta.sign_stability || 0.5,
          },
        };
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('exceeds max nodes') || msg.includes('exceeds max edges')) {
        return reply.code(400).send({
          schema: 'error.v1',
          code: 'SCOPE_LIMIT',
          message: msg,
        });
      }
      throw err;
    }
    
    // Warn in production when SCM-Lite is disabled
    if (process.env.NODE_ENV === 'production' && process.env.SCM_LITE_ENABLE !== '1') {
      app.log.warn({ feature: 'scm_lite', enabled: false, inference_mode }, 'SCM_LITE disabled — using placeholder results');
    }

    // Build response with meta in alphabetical position
    let debug: any = undefined;
    
    // Add debug.compare if requested and flag enabled
    if (include_debug && process.env.COMPARE_VIEW_ENABLE === '1') {
      debug = {
        compare: {
          [outcome_node]: {
            p10: results.conservative.outcome,
            p50: results.most_likely.outcome,
            p90: results.optimistic.outcome,
            top3_edges: computeSensitivitySimple(graph.edges, outcome_node),
          },
        },
      };
    }
    
    // Add debug.inspector if requested and flag enabled
    if (include_debug && process.env.INSPECTOR_DEBUG_ENABLE === '1') {
      if (!debug) debug = {};
      debug.inspector = {
        edges: graph.edges.map((edge, idx) => ({
          edge_id: `${edge.from}::${edge.to}::${idx}`,
          from: edge.from,
          to: edge.to,
          label: edge.label ?? '',
          weight: edge.weight ?? 0,
          belief: edge.belief ?? 1.0,
          provenance: edge.provenance ?? 'template',
        })),
      };
    }
    
    // P0: Compute top edge drivers (always included, not gated by include_debug)
    const top_edge_drivers = computeSensitivitySimple(graph.edges, outcome_node).slice(0, 3);
    
    const base: any = {
      confidence,
      critique,
      ...(debug && { debug }),
      explain_delta: {
        ...explain_delta,
        top_edge_drivers, // P0: top-3 edge drivers (separate from node-based top_drivers)
      },
      graph,
      identifiability: identifiability.summary,
      meta: {
        seed,
        commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
        version: '1.0.0',
        inference_mode,
      },
      model_card,
      result: {
        response_hash: hashCanonicalInput(body), // P0: hash of canonical inputs only
        summary: {
          p10: results.conservative.outcome,
          p50: results.most_likely.outcome,
          p90: results.optimistic.outcome,
        },
      },
      results,
      schema: 'run.v1',
    };
    
    // Add BMA hash BEFORE stamping (must be included in response_hash)
    if (scm_bma_hash) {
      base.model_card.bma_hash = scm_bma_hash;
    }
    
    // Stamp response hash (handles circularity correctly)
    const stamped = stampResponseHash(base);
    // Optional trace_id (not included in response_hash)
    if (process.env.TRACE_MIN === '1') {
      stamped.trace_id = randomUUID();
    }
    
    // Record compute time for observability
    const computeMs = performance.now() - computeStart;
    recordEngineComputeMs(computeMs);
    
    return stamped;
  });

  // Capability probe: HEAD /v1/run returns 405 with Allow header
  try {
    app.head('/v1/run', async (_req: FastifyRequest, reply: FastifyReply) => {
      try { reply.header('Allow', 'POST, OPTIONS, HEAD'); } catch {}
      return reply.code(405).send();
    });
  } catch (err: any) {
    if (err?.code !== 'FST_ERR_DUPLICATED_ROUTE') throw err;
  }
}
