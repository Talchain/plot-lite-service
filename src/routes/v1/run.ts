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
import type { Graph, DetailLevel } from '../../trust/types.js';
import { DETAIL_LEVEL_CONFIG } from '../../trust/types.js';
import { getInferenceEngine, type InferenceMode } from '../../inference/index.js';
import { computeSensitivitySimple, computeSensitivityAll } from '../../lib/sensitivity-simple.js';
import { computeSensitivitySummary } from '../../trust/sensitivity-summary.js';
import { computeGraphQuality } from '../../trust/graph-quality.js';
import { generateInsights } from '../../trust/insights.js';
import { analyseEvidence } from '../../trust/evidence-analysis.js';
import { computeFullSensitivity } from '../../trust/sensitivity-full.js';
import { calculateCalibratedConfidence, compareConfidence } from '../../trust/confidence-calibrated.js';
import { recordEngineComputeMs } from '../../metrics.js';
import {
  recordCeeAttempted,
  recordCeeOk,
  recordCeeDegraded,
  recordCeeSkipped,
} from '../../metrics/registry.js';
import { normalizeCeeCode, isFlagOn } from '../../cee/codes.js';
import { shouldAllowCeeCall, recordCeeSuccess, recordCeeFailure } from '../../cee/circuit-breaker.js';
import { runResponseSchema } from '../../schemas/response.js';
import { normalizeGraph } from '../../util/normalize.js';
import { FLAGS } from '../../config/flags.js';
import {
  BODY_LIMIT_BYTES,
  LIMITS_MAX_NODES,
  LIMITS_MAX_EDGES,
  VALIDATION_MAX_NODES,
  VALIDATION_MAX_EDGES
} from '../../config/constants.js';
import { validateEffect, applyEffect } from '../../engine/effects.js';
import { callDecisionReviewFromEngine } from '../../cee/client.js';


export interface RunRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
  query?: any;
  inference_mode?: 'model_based' | 'model_of_inference';
  include_debug?: boolean;
  constraints?: any;
  priors?: Record<string, number | { mean: number; sd: number }>;
  evidence?: Array<{ node_id: string; source: string; note?: string; weight?: number }>;
  targets?: string[];
  detail_level?: 'quick' | 'standard' | 'deep';
}

export async function registerRunRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  const { principalFor, getCached, setCached, pruneExpired, markInflight, clearInflight } = await import('../../middleware/idempotency.js');
  
  // HEAD /v1/run for UI probe - returns 405 with Allow header
  // UI expects non-404 to indicate route exists (200/401/403/405 all valid)
  app.head('/v1/run', async (_req, reply) => {
    reply.header('Allow', 'POST, OPTIONS, HEAD');
    return reply.code(405).send();
  });

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
          include_debug: { type: 'boolean' },
          constraints: { type: 'object' },
          priors: { type: 'object' },
          evidence: { type: 'array' },
          detail_level: { type: 'string', enum: ['quick', 'standard', 'deep'] },
        },
        additionalProperties: true,
      },
    },
    attachValidation: true,  // Attach validation errors to request instead of auto-failing
    bodyLimit: BODY_LIMIT_BYTES,
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
          (req as any).__idempotent_replay = true;
          try { reply.header('Idempotent-Replayed', '1'); } catch {}
          return reply.code(hit.status).type('application/json').send(hit.body);
        }
        markInflight(principal, idk);
        // Mark for onSend storage
        (req as any).__idempotent_replay = false;
        (req as any).__idemp = { principal, idk };
        try { reply.header('Idempotent-Replayed', '0'); } catch {}
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
          // P0: Always clear inflight (even for non-2xx)
          const { clearInflight } = await import('../../middleware/idempotency.js');
          clearInflight(marker.principal, marker.idk);
          
          // Only cache 2xx responses
          if (body && typeof body === 'object') {
            const status = reply.statusCode || 200;
            if (status >= 200 && status < 300) {
              setCached(marker.principal, marker.idk, status, body);
              try { reply.header('Idempotent-Replayed', '0'); } catch {}
            }
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
    
    // Normalize targets: canonical targets field, fallback to legacy query.targets
    const targets = body.targets ?? (body.query as any)?.targets ?? [];
    
    // Normalize graph (map confidence|probability→belief, no default on ingress)
    const graph = normalizeGraph(body.graph, false);
    
    // Validate priors if present
    if (body.priors) {
      const { validatePriors } = await import('../../lib/validate-priors.js');
      const nodeIds = new Set<string>(graph.nodes.map((n: any) => String(n.id)));
      const priorsValidation = validatePriors(body.priors, nodeIds);
      
      if (!priorsValidation.valid) {
        const firstError = priorsValidation.errors[0];
        req.log.info({ 
          evt: 'priors_validation_failed', 
          id: req.id, 
          route: '/v1/run', 
          errors: priorsValidation.errors 
        });
        return reply.code(400).send({
          error: { 
            type: 'BAD_INPUT', 
            message: firstError.message,
            field: firstError.field
          }
        });
      }
    }
    
    // Validate evidence if present
    if (body.evidence) {
      const { validateEvidence } = await import('../../lib/validate-evidence.js');
      const nodeIds = new Set<string>(graph.nodes.map((n: any) => String(n.id)));
      const evidenceValidation = validateEvidence(body.evidence, nodeIds);
      
      if (!evidenceValidation.valid) {
        const firstError = evidenceValidation.errors[0];
        req.log.info({ 
          evt: 'evidence_validation_failed', 
          id: req.id, 
          route: '/v1/run', 
          errors: evidenceValidation.errors 
        });
        return reply.code(400).send({
          error: { 
            type: 'BAD_INPUT', 
            message: firstError.message,
            field: firstError.field
          }
        });
      }
    }
    
    // Validate node effects if present (backwards-compatible)
    for (const node of graph.nodes) {
      if ((node as any).effect) {
        const validation = validateEffect((node as any).effect);
        if (!validation.valid) {
          req.log.info({ evt: 'effect_validation_failed', id: req.id, route: '/v1/run', node: node.id, error: validation.error });
          return reply.code(400).send({
            error: { type: 'BAD_INPUT', message: `Invalid effect on node ${node.id}: ${validation.error}` }
          });
        }
      }
    }
    
    // Validate constraints if present
    if (body.constraints) {
      const nodeIds = new Set(graph.nodes.map((n: any) => n.id));
      
      // Validate bounds
      if (body.constraints.bounds) {
        for (const [nodeId, bounds] of Object.entries(body.constraints.bounds)) {
          if (!nodeIds.has(nodeId)) {
            req.log.info({ evt: 'constraints_violation', id: req.id, route: '/v1/run', reason: 'invalid_node_in_bounds', node: nodeId });
            return reply.code(400).send({
              error: { type: 'BAD_INPUT', message: `Bounds constraint references non-existent node: ${nodeId}` }
            });
          }
          
          // Check if any node values violate bounds (simplified check for now)
          const node = graph.nodes.find((n: any) => n.id === nodeId);
          if (node && typeof (node as any).value === 'number') {
            const val = (node as any).value;
            const b = bounds as any;
            if (b.min !== undefined && val < b.min) {
              req.log.info({ evt: 'constraints_violation', id: req.id, route: '/v1/run', reason: 'bounds_min', node: nodeId, value: val, min: b.min });
              return reply.code(400).send({
                error: { type: 'BAD_INPUT', message: `Node ${nodeId} value ${val} violates min bound ${b.min}` }
              });
            }
            if (b.max !== undefined && val > b.max) {
              req.log.info({ evt: 'constraints_violation', id: req.id, route: '/v1/run', reason: 'bounds_max', node: nodeId, value: val, max: b.max });
              return reply.code(400).send({
                error: { type: 'BAD_INPUT', message: `Node ${nodeId} value ${val} violates max bound ${b.max}` }
              });
            }
          }
        }
      }
      
      // Validate structure (forbid edges)
      if (body.constraints.structure?.forbid_edges) {
        for (const [from, to] of body.constraints.structure.forbid_edges) {
          const forbiddenEdge = graph.edges.find((e: any) => e.from === from && e.to === to);
          if (forbiddenEdge) {
            req.log.info({ evt: 'constraints_violation', id: req.id, route: '/v1/run', reason: 'forbidden_edge', from, to });
            return reply.code(400).send({
              error: { type: 'BAD_INPUT', message: `Forbidden edge present: ${from} → ${to}` }
            });
          }
        }
      }
    }

    // Per-request SCM-Lite gating: header → query → env (lower-cased)
    function scmLiteEnabled(req: FastifyRequest): { enabled: boolean; source: string } {
      const h = String((req.headers as any)['x-scm-lite'] ?? '').toLowerCase();
      if (h === '1' || h === 'true') return { enabled: true, source: 'header' };
      
      const q = String((req as any).query?.scm_lite ?? '').toLowerCase();
      if (q === '1' || q === 'true') return { enabled: true, source: 'query' };
      
      const env = String(process.env.SCM_LITE_ENABLE ?? '').toLowerCase();
      if (env === '1' || env === 'true') return { enabled: true, source: 'env' };
      
      return { enabled: false, source: 'none' };
    }
    
    // Placeholder mode: production + disabled + flag set
    function placeholderEnabled(useLite: boolean): boolean {
      if (useLite) return false;  // Never placeholder if enabled
      const isProd = process.env.NODE_ENV === 'production';
      const flag = String(process.env.PROD_SCM_LITE_PLACEHOLDER ?? '').toLowerCase();
      return isProd && (flag === '1' || flag === 'true');
    }
    
    const { enabled: useScmLite, source } = scmLiteEnabled(req);
    const usePlaceholder = placeholderEnabled(useScmLite);
    
    // Test probe: harmless header for debugging
    reply.header('x-scm-lite', useScmLite ? '1' : '0');
    
    // Early return placeholder when disabled in production
    if (usePlaceholder) {
      return reply.send({
        schema: 'run.v1',
        results: [],
        confidence: { p10: 0, p50: 0, p90: 0 },
        model_card: { response_hash: 'placeholder' },
        meta: { seed: body.seed ?? 4242 },
      });
    }
    
    // SCM-Lite schema and caps (use centralized constants)
    const schema = useScmLite ? 'report.v1' : 'run.v1';
    const maxNodes = useScmLite ? LIMITS_MAX_NODES : VALIDATION_MAX_NODES;
    const maxEdges = useScmLite ? LIMITS_MAX_EDGES : VALIDATION_MAX_EDGES;

    const nodeCount = graph.nodes?.length ?? 0;
    const edgeCount = graph.edges?.length ?? 0;
    if (nodeCount > maxNodes || edgeCount > maxEdges) {
      // P0: Clear inflight key on early 400 exit
      const marker = (req as any).__idemp;
      if (marker) {
        try { clearInflight(marker.principal, marker.idk); } catch {}
      }
      return reply.code(400).send({
        error: 'bad_request',
        reason: 'graph_too_large',
        limits: { nodes: maxNodes, edges: maxEdges },
      });
    }


    // Resolve detail_level and its configuration
    const detail_level: DetailLevel = body.detail_level ?? 'standard';
    const detailConfig = DETAIL_LEVEL_CONFIG[detail_level];

    const {
      seed = 42,
      treatment_node = graph.nodes[0]?.id,
      outcome_node = graph.nodes[graph.nodes.length - 1]?.id,
      baseline_value = 100,
      inference_mode = 'model_based',
      include_debug = false,
    } = body;

    // K samples: explicit k_samples provides a hint, but budget.k is enforced
    const requested_k = body.k_samples ?? detailConfig.k_samples;

    // Cost governance - enforces budget limits on requested K
    const budget = enforceComputeBudget({
      graph,
      requested_k,
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
    const { getActiveBackend } = await import('../../config/backend.js');
    const backend = getActiveBackend();
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
      backend,
    });

    // Add detail_level to model_card
    model_card.detail_level = detail_level;

    // Identifiability tag (flag-gated)
    if (process.env.IDENT_TAG_ENABLE === '1') {
      const { generateIdentifiabilityTag } = await import('../../trust/identifiability-tag.js');
      model_card.identifiability_tag = generateIdentifiabilityTag({
        identifiable: identifiability.identifiable,
        has_backdoor_paths: identifiability.adjustment_set.length > 0,
        adjustment_set_size: identifiability.adjustment_set.length,
      });
    }

    // Linearity check and confidence - will be computed after inference with actual p50
    let linearity_warning: ReturnType<typeof checkLinearity>;
    let confidence: ReturnType<typeof calculateConfidence>;
    let threshold_crossings: ReturnType<typeof detectThresholdCrossings>;
    let fork_suggestions: ReturnType<typeof generateForkSuggestions> | undefined;

    // Critique (skipped for quick mode)
    const critique = detailConfig.run_critique
      ? buildCritique({
          graph,
          assumptions: model_card.assumptions_summary,
          identifiable: identifiability.identifiable,
          node_limit: 12,
        })
      : [];

    // Explain-Δ - will be computed after inference with actual p50
    let explain_delta: ReturnType<typeof buildExplainDelta>;

    // Execute inference using selected mode
    const inferenceEngine = getInferenceEngine(inference_mode);
    let results: any;
    let scm_bma_hash: string | undefined;
    let K_evaluated: number | undefined;
    let K_requested: number | undefined;
    let K_converged: boolean | undefined;

    // Adaptive K: enabled for standard/deep, threshold varies
    // quick = no adaptive, standard = 1%, deep = 0.5%
    const adaptiveK = detail_level !== 'quick';
    const convergenceThreshold = detail_level === 'deep' ? 0.005 : 0.01;

    // Use budget.k (enforced value) for actual inference, not the raw request
    const k_samples = budget.k;

    try {
      const inferenceResult = await inferenceEngine.run(graph, {
        seed,
        k_samples,
        outcome_node,
        baseline_value,
        priors: body.priors,
        adaptiveK,
        convergenceThreshold,
      });
      
      results = {
        conservative: inferenceResult.conservative,
        most_likely: inferenceResult.most_likely,
        optimistic: inferenceResult.optimistic,
      };

      scm_bma_hash = inferenceResult.meta?.bma_hash;
      K_evaluated = inferenceResult.meta?.K_evaluated;
      K_requested = inferenceResult.meta?.K_requested;
      K_converged = inferenceResult.meta?.K_converged;

      // Add adaptive K parameters to model_card
      model_card.parameters = {
        K: K_evaluated ?? k_samples,
        ...(K_requested !== undefined && { K_requested }),
        ...(K_converged !== undefined && { K_converged }),
      };

      // P1-6: Compute linearity using actual p50 outcome (not placeholder)
      const current_value = results.most_likely.outcome;
      linearity_warning = checkLinearity({
        baseline_value,
        current_value,
        linear_range_percent: 20,
      });

      // Compute confidence with actual linearity and actual K evaluated (not requested)
      confidence = calculateConfidence({
        graph,
        identifiable: identifiability.identifiable,
        in_linear_range: !linearity_warning.outside_range,
        k_samples: K_evaluated ?? budget.k,
        calibrated: false,
      });

      // Threshold crossings with actual p50
      threshold_crossings = detectThresholdCrossings({
        metric_name: 'outcome',
        from_value: baseline_value,
        to_value: current_value,
        thresholds: [99, 199, 299],
      });

      // Fork suggestions if threshold crossed
      fork_suggestions = threshold_crossings.length > 0
        ? generateForkSuggestions({
            metric_name: 'outcome',
            current_value,
            threshold: threshold_crossings[0].threshold,
            direction: threshold_crossings[0].direction,
          })
        : undefined;

      // Explain-Δ with actual p50
      explain_delta = buildExplainDelta({
        graph,
        baseline_outcome: baseline_value,
        counterfactual_outcome: current_value,
        seed,
        top_n: 3,
      });

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
        // P0: Clear inflight key on early 400 exit
        const marker = (req as any).__idemp;
        if (marker) {
          try { clearInflight(marker.principal, marker.idk); } catch {}
        }
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
      const usesPlaceholder = process.env.PROD_SCM_LITE_PLACEHOLDER === '1';
      app.log.warn(
        { feature: 'scm_lite', enabled: false, placeholder: usesPlaceholder, inference_mode },
        usesPlaceholder
          ? 'SCM_LITE disabled — using placeholder results'
          : 'SCM_LITE disabled — running full inference'
      );
    }

    // Build response with meta in alphabetical position
    let debug: any = undefined;
    
    // Add debug.compare if requested and flag enabled
    if (include_debug && FLAGS.COMPARE_VIEW_ENABLE) {
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
    if (include_debug && FLAGS.INSPECTOR_DEBUG_ENABLE) {
      if (!debug) debug = {};
      debug.inspector = {
        edges: graph.edges.map((edge: any, idx: number) => ({
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
    const top_edge_drivers = computeSensitivitySimple(graph.edges, outcome_node);

    // Compute all edges once and reuse for summary, full sensitivity, etc.
    const all_edges = detailConfig.run_sensitivity || detail_level === 'deep'
      ? computeSensitivityAll(graph.edges, outcome_node)
      : [];

    // P1: Compute sensitivity summary using ALL edges (not just top 3) for accurate concentration
    const sensitivity_summary = detailConfig.run_sensitivity
      ? computeSensitivitySummary(all_edges)
      : undefined;

    // Sprint N: Evidence-Aware Critique - analyse which edges are backed by evidence vs assumptions
    const evidence_analysis = detailConfig.run_critique
      ? analyseEvidence({
          edges: graph.edges.map((edge: any, idx: number) => ({
            id: `${edge.from}::${edge.to}::${idx}`,
            from: edge.from,
            to: edge.to,
            provenance: edge.provenance,
          })),
          top_drivers: top_edge_drivers.map(d => ({
            edge_id: d.edge_id,
            score: d.score,
          })),
        })
      : undefined;

    // Sprint N: Full Sensitivity - all edges with HHI concentration (deep detail level only)
    const sensitivity_full = detail_level === 'deep'
      ? computeFullSensitivity(all_edges)
      : undefined;

    // Sprint N: Confidence Comparison - compare current vs calibrated formulas (deep detail level only)
    // Note: This is an experimental comparison between current and a prototype calibrated formula
    const confidence_comparison = detail_level === 'deep'
      ? (() => {
          // Calculate calibrated confidence using kernel meta if available
          const calibratedResult = calculateCalibratedConfidence({
            mask_diversity: scm_bma_hash ? 0.7 : 0.5, // Better diversity if BMA hash available
            path_stability: identifiability.identifiable ? 0.8 : 0.4,
            linearity_distance: linearity_warning.distance_from_center / 100,
            k_samples: K_evaluated ?? budget.k,
          });
          return compareConfidence(confidence, calibratedResult);
        })()
      : undefined;

    // P1: Compute graph quality score
    // Only count edges with external evidence (exclude 'template' and 'assumption' - aligned with evidence-analysis)
    const ASSUMPTION_PROVENANCES = ['template', 'assumption'];
    const edges_with_provenance = graph.edges.filter(
      (e: any) => e.provenance && !ASSUMPTION_PROVENANCES.includes(e.provenance.toLowerCase())
    ).length;
    const critique_blockers = critique.filter((c: any) => c.severity === 'BLOCKER').length;
    const critique_warnings = critique.filter((c: any) => c.severity === 'IMPROVEMENT').length;
    const graph_quality = computeGraphQuality({
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      edges_with_provenance,
      critique_issues: critique_blockers,
      identifiable: identifiability.identifiable,
    });

    // P1: Generate insights block (human-readable summary without user content)
    const insights = generateInsights({
      p10: results.conservative.outcome,
      p50: results.most_likely.outcome,
      p90: results.optimistic.outcome,
      baseline: baseline_value,
      confidence_level: confidence.level,
      critique_blockers,
      critique_warnings,
      evidence_coverage: graph_quality.evidence_coverage,
      top_driver_label: top_edge_drivers[0]?.edge_id?.split('::')[0],
    });

    const base: any = {
      confidence,
      critique,
      ...(debug && { debug }),
      explain_delta: {
        ...explain_delta,
        top_edge_drivers,
      },
      graph,
      graph_quality,
      identifiability: identifiability.summary,
      insights,
      linearity_warning,
      ...(sensitivity_summary && { sensitivity_summary }),
      ...(evidence_analysis && { evidence_analysis }),
      ...(sensitivity_full && { sensitivity_full }),
      ...(confidence_comparison && { confidence_comparison }),
      meta: {
        seed,
        commit: process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev',
        version: '1.0.0',
        inference_mode,
        ...(body.evidence && body.evidence.length > 0 && {
          evidence_applied: (await import('../../lib/validate-evidence.js')).sanitizeEvidence(body.evidence)
        }),
      },
      model_card,
      result: {
        response_hash: hashCanonicalInput(body),
        summary: {
          p10: results.conservative.outcome,
          p50: results.most_likely.outcome,
          p90: results.optimistic.outcome,
        },
      },
      results,
      schema,
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

    // Attach optional CEE decision review for idempotent (saved) runs
    let response: any = stamped;

    // CEE gate: {idk}:{flag}:{status}:{code}
    const idkHeader = String((req.headers as any)['idempotency-key'] || (req.headers as any)['Idempotency-Key'] || '').trim();
    const ceeEnabled = isFlagOn(process.env.CEE_ORCHESTRATOR_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED);
    const baseUrl = String(process.env.CEE_BASE_URL ?? '').trim();
    const apiKey = String(process.env.CEE_API_KEY ?? '').trim();
    const hasConfig = baseUrl.length > 0 && apiKey.length > 0;

    let ceeStatus = 'skipped';
    let ceeCode = '';

    if (!idkHeader) {
      ceeStatus = 'skipped';
      ceeCode = 'no_idk';
      recordCeeSkipped('/v1/run', 'no_idk');
    } else if (!ceeEnabled) {
      ceeStatus = 'skipped';
      ceeCode = 'flag_off';
      recordCeeSkipped('/v1/run', 'flag_off');
    } else if (!hasConfig) {
      ceeStatus = 'skipped';
      ceeCode = 'no_config';
      recordCeeSkipped('/v1/run', 'no_config');
    } else if (!detailConfig.run_cee) {
      // Quick mode skips CEE for speed - check BEFORE circuit breaker
      // to avoid toggling breaker state for requests that won't call CEE anyway
      ceeStatus = 'skipped';
      ceeCode = 'quick_mode';
      recordCeeSkipped('/v1/run', 'quick_mode');
    } else if (!shouldAllowCeeCall()) {
      // Circuit breaker is open - skip CEE to prevent cascading failures
      ceeStatus = 'skipped';
      ceeCode = 'circuit_open';
      recordCeeSkipped('/v1/run', 'circuit_open');
    } else {
      // Attempt CEE call
      recordCeeAttempted('/v1/run');
      try {
        const cee = await callDecisionReviewFromEngine({
          requestId: String(req.id),
          context: {
            response_hash: response.result?.response_hash,
            seed,
            inference_mode,
            graph_summary: {
              nodes: graph.nodes?.length ?? 0,
              edges: graph.edges?.length ?? 0,
            },
          },
          env: {
            enable: ceeEnabled,
            baseUrl,
            apiKey,
            timeoutMs: Number(process.env.CEE_TIMEOUT_MS ?? 10_000),
          },
          evidence: body.evidence,
        });

        // Determine status and code
        if (cee.error) {
          ceeStatus = 'degraded';
          ceeCode = cee.error.code || 'unknown';
          recordCeeDegraded('/v1/run', normalizeCeeCode(ceeCode));
          recordCeeFailure(); // Circuit breaker: track failure
        } else {
          ceeStatus = 'ok';
          ceeCode = '';
          recordCeeOk('/v1/run');
          recordCeeSuccess(); // Circuit breaker: reset on success
        }

        // Only attach CEE fields if they have actual data (not null)
        if (cee.review !== null) {
          (response as any).ceeReview = cee.review;
        }
        if (cee.trace) {
          (response as any).ceeTrace = cee.trace;
        }
        if (cee.error) {
          (response as any).ceeError = cee.error;
        }
      } catch (err: any) {
        ceeStatus = 'error';
        ceeCode = err?.code || 'client_error';
        recordCeeDegraded('/v1/run', normalizeCeeCode(ceeCode));
        recordCeeFailure(); // Circuit breaker: track failure

        const errorMeta = {
          evt: 'cee_integration_error',
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          requestId: req.id,
          ceeBaseUrl: baseUrl,
          hasEvidence: !!body.evidence,
        };

        try {
          req.log?.error?.(errorMeta, 'CEE integration failed; continuing without CEE');
        } catch (logErr) {
          // Last resort: don't crash, but ensure visibility
          console.error('[CEE] Integration and logging failed', {
            originalError: errorMeta,
            loggingError: logErr instanceof Error ? logErr.message : String(logErr),
          });
        }
      }
    }

    // X-CEE-Debug header: {idk}:{flag}:{status}:{code}
    // Only expose in non-production or when explicitly enabled
    if (process.env.NODE_ENV !== 'production' || process.env.CEE_DEBUG_ENABLE === '1') {
      try {
        const hdr = [
          idkHeader ? '1' : '0',
          ceeEnabled ? '1' : '0',
          ceeStatus,
          ceeCode,
        ].join(':');
        reply.header('X-CEE-Debug', hdr);
      } catch {}
    }

    // Structured log
    try {
      req.log?.info?.({
        evt: 'cee_debug',
        idk_seen: !!idkHeader,
        cee_enabled: ceeEnabled,
        has_config: hasConfig,
        status: ceeStatus,
        code: ceeCode,
      }, 'CEE debug');
    } catch {}

    // Record compute time for observability
    const computeMs = performance.now() - computeStart;
    recordEngineComputeMs(computeMs);

    // Add X-Olumi-Backend header
    try {
      const buildTag = process.env.BUILD_ID || process.env.GITHUB_SHA || 'dev';
      reply.header('X-Build-Tag', buildTag);
    } catch {}
    reply.header('X-Olumi-Backend', backend);

    return response;
  });
}
