/**
 * POST /v1/run_bundle - Scenario bundle processing
 * Takes a base graph + labeled deltas for efficient multi-scenario evaluation
 * Uses real SCM-Lite inference for each scenario (not stubs)
 *
 * Enhanced with:
 * - include_ranking: Rank options by outcome (default: true)
 * - include_change_attribution: Explain why options differ from baseline
 * - baseline_index: Which delta is the baseline for comparison
 * - sort_by: Rank by p10, p50, or p90
 *
 * Phase 1 Decision Support:
 * - ranking_mode: 'simple' (default) or 'utility'
 * - primary_outcome: Auto-detected or explicit
 * - utility_function: Required when ranking_mode='utility'
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { replyWithAppError } from '../../errors.js';
import { canonicalIdempotencyPreHandler, canonicalIdempotencyOnSend } from '../../middleware/idempotency-canonical.js';
import { BODY_LIMIT_BYTES } from '../../config/constants.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import { sha8 } from '../../util/pii-redact.js';
import type { DetailLevel } from '../../trust/types.js';
import { DETAIL_LEVEL_CONFIG } from '../../trust/types.js';
import { computeRankingConfidence, isWinnerDominant } from '../../trust/ranking-confidence.js';
import { buildChangeAttributionFromDelta } from '../../util/change-attribution.js';
import { getTopNodeSensitivity } from '../../trust/sensitivity-node.js';
import { computeSensitivityAll } from '../../lib/sensitivity-simple.js';
import { detectPrimaryOutcome, shouldSuggestUtilityMode } from '../../services/ranking/outcome-detector.js';
import { validateUtilityLocal } from '../../services/ranking/utility-validator.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import type { EdgeTypeWarning } from '../../services/ranking/edge-type-inference.js';
import type { RankingSortKey, RankingSummary, RankingMode, UtilityFunction, UtilitySuggestion, ResponseWarning, EdgeTypeInferenceSummary, ConstraintStatus, CoherenceWarning } from './types/run-bundle.types.js';
import { processWithConcurrency } from '../../util/semaphore.js';
import {
  computeDeltasVsBaseline,
  validateCoherence,
  emptyConstraintStatus,
  type RankableResult,
} from '../../trust/result-coherence.js';
import {
  analyzeEdgeFunctionSensitivity,
  shouldAnalyzeEdgeFunctionSensitivity,
} from '../../engine/edge-function-sensitivity.js';
import { MAX_NODES, MAX_EDGES, MAX_OPTIONS } from '../../constants/limits.js';
import { FLAGS } from '../../config/flags.js';
import { assembleFactsFromBundleResults } from '../../facts/index.js';
import type { FactsEnvelope, FactLineage } from '../../facts/types.js';
import { generatePreAnalysisReview, generatePostAnalysisReview } from '../../review-pass/index.js';
import type { ReviewPassEnvelopeV1 } from '../../review-pass/types.js';
import { computeGraphViolations } from '../../lib/graph-violations.js';

interface GraphDelta {
  label: string;
  nodes?: Array<{ id: string; value?: number; label?: string; [key: string]: any }>;
  edges?: Array<{ from: string; to: string; weight?: number; [key: string]: any }>;
}

interface RunBundleRequest {
  base_graph: { nodes: any[]; edges: any[] };
  deltas: GraphDelta[];
  seed?: number;
  detail_level?: DetailLevel;
  baseline_value?: number;
  outcome_node?: string;
  priors?: Record<string, number | { mean: number; sd: number }>;
  evidence?: Array<{ node_id: string; source: string; note?: string; weight?: number }>;
  // Enhanced parameters
  include_ranking?: boolean;
  include_change_attribution?: boolean;
  baseline_index?: number;
  sort_by?: RankingSortKey;
  // Phase 1: Decision Support Enhancement
  ranking_mode?: RankingMode;
  utility_function?: UtilityFunction;
  primary_outcome?: string;
}

// MAX_NODES, MAX_EDGES imported from constants/limits.ts
const MAX_DELTAS = MAX_OPTIONS; // Alias for backwards compatibility

// P0: Concurrency control for scenario processing
// Limits parallel inference to prevent CPU spikes under load
const rawConcurrency = parseInt(process.env.RUN_BUNDLE_MAX_CONCURRENCY || '4', 10);
const RUN_BUNDLE_CONCURRENCY = Math.max(1, Math.min(MAX_DELTAS, Number.isNaN(rawConcurrency) ? 4 : rawConcurrency));

if (process.env.RUN_BUNDLE_MAX_CONCURRENCY !== undefined) {
  if (Number.isNaN(rawConcurrency)) {
    console.warn(`[run-bundle] Invalid RUN_BUNDLE_MAX_CONCURRENCY="${process.env.RUN_BUNDLE_MAX_CONCURRENCY}", using default 4`);
  } else if (rawConcurrency !== RUN_BUNDLE_CONCURRENCY) {
    console.warn(`[run-bundle] RUN_BUNDLE_MAX_CONCURRENCY=${rawConcurrency} clamped to ${RUN_BUNDLE_CONCURRENCY} (valid range: 1-${MAX_DELTAS})`);
  }
}

export async function registerRunBundleRoute(app: FastifyInstance) {
  app.post(
    '/v1/run_bundle',
    {
      onRequest: [
        async (req: FastifyRequest, reply: FastifyReply) => {
          const raw = String(req.headers['content-length'] || '').trim();
          const len = raw ? Number(raw) : NaN;
          if (Number.isFinite(len) && len > BODY_LIMIT_BYTES) {
            return replyWithAppError(reply as any, {
              type: 'BAD_INPUT',
              statusCode: 413,
              message: 'Request body too large',
              fields: { code: 'PAYLOAD_TOO_LARGE' },
            });
          }
        },
      ],
      preHandler: [
        async (req: FastifyRequest, reply: FastifyReply) => {
          await canonicalIdempotencyPreHandler(req, reply, '/v1/run_bundle');
        },
      ],
      onSend: [
        async (req: FastifyRequest, reply: FastifyReply, payload: any) => {
          return canonicalIdempotencyOnSend(req, reply, payload);
        },
      ],
      bodyLimit: BODY_LIMIT_BYTES,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as RunBundleRequest;
    
    // Validation
    if (!body.base_graph || !body.base_graph.nodes || !Array.isArray(body.base_graph.nodes)) {
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400,
        message: 'base_graph.nodes required',
        fields: { field: 'base_graph.nodes' },
      });
    }
    
    if (!body.deltas || !Array.isArray(body.deltas) || body.deltas.length === 0) {
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400,
        message: 'deltas array required with at least one scenario',
        fields: { field: 'deltas' },
      });
    }
    
    if (body.deltas.length > MAX_DELTAS) {
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400,
        message: `Maximum ${MAX_DELTAS} deltas allowed, got ${body.deltas.length}`,
        fields: { field: 'deltas' },
      });
    }
    
    // Validate base graph limits
    if (body.base_graph.nodes.length > MAX_NODES) {
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400,
        message: `base_graph exceeds max ${MAX_NODES} nodes`,
        fields: { field: 'base_graph.nodes' },
      });
    }
    
    // Validate base_graph.edges is array if present
    if (body.base_graph.edges !== undefined && !Array.isArray(body.base_graph.edges)) {
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400,
        message: 'base_graph.edges must be an array',
        fields: { field: 'base_graph.edges' },
      });
    }
    
    // Validate priors if present
    if (body.priors) {
      const { validatePriors } = await import('../../lib/validate-priors.js');
      const nodeIds = new Set<string>(body.base_graph.nodes.map((n: any) => String(n.id)));
      const priorsValidation = validatePriors(body.priors, nodeIds);
      
      if (!priorsValidation.valid) {
        const firstError = priorsValidation.errors[0];
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: firstError.message,
          fields: { field: firstError.field },
        });
      }
    }
    
    // Validate evidence if present
    if (body.evidence) {
      const { validateEvidence } = await import('../../lib/validate-evidence.js');
      const nodeIds = new Set<string>(body.base_graph.nodes.map((n: any) => String(n.id)));
      const evidenceValidation = validateEvidence(body.evidence, nodeIds);
      
      if (!evidenceValidation.valid) {
        const firstError = evidenceValidation.errors[0];
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: firstError.message,
          fields: { field: firstError.field },
        });
      }
    }
    
    const baseEdges = body.base_graph.edges || [];
    if (baseEdges.length > MAX_EDGES) {
      return replyWithAppError(reply, { 
        type: 'BAD_INPUT', 
        statusCode: 400,
        message: `base_graph exceeds max ${MAX_EDGES} edges`,
        fields: { field: 'base_graph.edges' },
      });
    }
    
    const seed = body.seed || 4242;
    const baseline_value = body.baseline_value ?? 100;
    const seenHashes = new Set<string>();

    // Validate detail_level if provided
    const VALID_DETAIL_LEVELS = ['quick', 'standard', 'deep'] as const;
    const detail_level: DetailLevel = body.detail_level ?? 'standard';
    if (!VALID_DETAIL_LEVELS.includes(detail_level as any)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Invalid detail_level '${body.detail_level}'; must be one of: quick, standard, deep`,
        fields: { field: 'detail_level' },
      });
    }
    const detailConfig = DETAIL_LEVEL_CONFIG[detail_level];

    // Validate unique scenario labels (P1-5: Contract requirement for clarity)
    const labels = body.deltas.map((d: { label?: string }) => d.label).filter((l): l is string => Boolean(l));
    const labelSet = new Set(labels);
    if (labelSet.size !== labels.length) {
      const duplicates = labels.filter((label, i) => labels.indexOf(label) !== i);
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Duplicate scenario labels detected: ${[...new Set(duplicates)].join(', ')}. All scenario labels must be unique.`,
        fields: { field: 'deltas[].label' },
      });
    }

    // Pre-validate all graphs and build scenario list
    const scenarios: Array<{
      index: number;
      label: string;
      graph: { nodes: any[]; edges: any[] };
      scenarioSeed: number;
    }> = [];

    // Phase 2: Track edge type inference warnings across all scenarios
    let edgeTypeExplicitCount = 0;
    let edgeTypeInferredCount = 0;
    const edgeTypeWarnings: EdgeTypeWarning[] = [];

    for (let i = 0; i < body.deltas.length; i++) {
      const delta = body.deltas[i];

      // Validate delta has a label
      if (!delta.label || typeof delta.label !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Delta at index ${i} is missing required 'label' field`,
          fields: { field: `deltas[${i}].label` },
        });
      }

      // Apply delta to base graph
      const rawGraph = applyDelta(body.base_graph, delta);

      // Validate merged graph limits
      if (rawGraph.nodes.length > MAX_NODES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Delta '${delta.label}' results in ${rawGraph.nodes.length} nodes (max ${MAX_NODES})`,
          fields: { field: `deltas[${i}]` },
        });
      }

      if (rawGraph.edges.length > MAX_EDGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Delta '${delta.label}' results in ${rawGraph.edges.length} edges (max ${MAX_EDGES})`,
          fields: { field: `deltas[${i}]` },
        });
      }

      // Normalize graph (map confidence|probability→belief)
      const normalizedGraph = normalizeGraph(rawGraph, false);

      // Phase 2: Apply edge type inference
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
      };

      // Track inference stats (only from first scenario to avoid duplicates)
      if (i === 0) {
        edgeTypeExplicitCount = edgeInference.explicit_count;
        edgeTypeInferredCount = edgeInference.inferred_count;
        edgeTypeWarnings.push(...edgeInference.warnings);
      }

      // Deterministic seed per scenario: base seed + index + 1
      const scenarioSeed = seed + i + 1;

      scenarios.push({
        index: i,
        label: delta.label,
        graph,
        scenarioSeed,
      });
    }

    // Phase 1: Determine ranking mode and validate utility function
    const rankingMode: RankingMode = body.ranking_mode ?? 'simple';
    let primaryOutcomeDetected = false;
    let detectedOutcomeNodes: string[] = [];
    let utilityModeExperimental = false;

    // Validate utility function if utility mode requested
    if (rankingMode === 'utility') {
      if (!body.utility_function) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'utility_function required when ranking_mode is "utility"',
          fields: { field: 'utility_function' },
        });
      }

      const utilityValidation = validateUtilityLocal(body.utility_function, body.base_graph.nodes);
      if (!utilityValidation.valid) {
        const firstError = utilityValidation.issues.find((i) => i.severity === 'error');
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: firstError?.message ?? 'Invalid utility_function',
          fields: { field: firstError?.field ?? 'utility_function' },
        });
      }

      // P0: Mark utility mode as experimental - ranking currently falls back to sort_by
      // Full utility-based ranking (weighted multi-outcome aggregation) is not yet implemented
      utilityModeExperimental = true;
    }

    // Determine outcome node with enhanced detection
    let outcome_node: string;
    if (body.outcome_node) {
      // Explicit outcome node provided
      outcome_node = body.outcome_node;
    } else if (body.primary_outcome) {
      // Explicit primary outcome provided (Phase 1 parameter)
      outcome_node = body.primary_outcome;
    } else if (scenarios[0]) {
      // Auto-detect primary outcome
      const detection = detectPrimaryOutcome(scenarios[0].graph);
      detectedOutcomeNodes = detection.outcome_nodes;

      if (detection.detected && detection.node_id) {
        outcome_node = detection.node_id;
        primaryOutcomeDetected = true;
      } else {
        // Fallback to last node (backward compatibility)
        outcome_node = scenarios[0].graph.nodes[scenarios[0].graph.nodes.length - 1]?.id;
      }
    } else {
      outcome_node = '';
    }

    // Get inference engine
    const inferenceEngine = getInferenceEngine('model_based');

    // Run inference on all scenarios with concurrency control
    // P0: Limits parallel inference to RUN_BUNDLE_MAX_CONCURRENCY (default: 4) to prevent CPU spikes
    const inferenceResults = await processWithConcurrency(
      scenarios,
      RUN_BUNDLE_CONCURRENCY,
      async (scenario) => {
        try {
          const result = await inferenceEngine.run(scenario.graph, {
            seed: scenario.scenarioSeed,
            k_samples: detailConfig.k_samples,
            outcome_node,
            baseline_value,
            priors: body.priors,
            adaptiveK: detail_level !== 'quick',
            convergenceThreshold: detail_level === 'deep' ? 0.005 : 0.01,
          });
          return {
            success: true as const,
            scenario,
            inference: result,
          };
        } catch (err) {
          // Log but continue - return fallback for this scenario
          // Wave1-L1 (PII, ROADMAP 2.56 residual (b)): scenario labels are raw
          // decision content — digest before logging. `index` is structural.
          req.log.warn({
            evt: 'run_bundle_inference_error',
            label_sha8: sha8(String(scenario.label)),
            index: scenario.index,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            success: false as const,
            scenario,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    );

    // Build results from inference
    const results = inferenceResults.map((ir) => {
      let p10: number, p50: number, p90: number;
      let K_evaluated: number | undefined;
      let backend: string;

      if (ir.success && ir.inference) {
        p10 = Math.round(ir.inference.conservative.outcome * 1000) / 1000;
        p50 = Math.round(ir.inference.most_likely.outcome * 1000) / 1000;
        p90 = Math.round(ir.inference.optimistic.outcome * 1000) / 1000;
        K_evaluated = ir.inference.meta?.K_evaluated;
        backend = ir.inference.meta?.engine ?? 'scm_lite';
      } else {
        // Fallback: deterministic hash-based results
        const graphHash = createHash('sha256')
          .update(JSON.stringify({ nodes: ir.scenario.graph.nodes, edges: ir.scenario.graph.edges, seed: ir.scenario.scenarioSeed }))
          .digest('hex');
        const hashValue = parseInt(graphHash.slice(0, 8), 16) / 0xffffffff;
        p50 = Math.round((hashValue * 0.3 + 0.5) * baseline_value * 1000) / 1000;
        p10 = Math.round(p50 * 0.8 * 1000) / 1000;
        p90 = Math.round(p50 * 1.2 * 1000) / 1000;
        backend = 'fallback';
      }

      const result: any = {
        label: ir.scenario.label,
        summary: { p10, p50, p90 },
        model_card: {
          seed: ir.scenario.scenarioSeed,
          nodes: ir.scenario.graph.nodes.length,
          edges: ir.scenario.graph.edges.length,
          backend,
          detail_level,
          ...(K_evaluated !== undefined && { K: K_evaluated }),
        },
      };

      // Create response hash for deduplication
      const responseHash = createHash('sha256')
        .update(JSON.stringify({ label: result.label, summary: result.summary }))
        .digest('hex')
        .slice(0, 16);

      result.model_card.response_hash = responseHash;

      // Track for dedup reporting
      if (seenHashes.has(responseHash)) {
        result.model_card.duplicate = true;
      } else {
        seenHashes.add(responseHash);
      }

      // Add error info if inference failed
      if (!ir.success) {
        result.model_card.inference_error = ir.error;
        result.error = {
          code: 'INFERENCE_FAILED',
          message: ir.error || 'Inference failed for this scenario',
        };
      }

      return result;
    });

    // === ENHANCED FEATURES ===

    // Parse enhancement options with defaults
    // IMPORTANT: These defaults are part of the API contract
    const includeRanking = body.include_ranking !== false; // Default: true (opt-out)
    const includeChangeAttribution = body.include_change_attribution === true; // Default: false (opt-in, computational cost)
    const baselineIndex = body.baseline_index ?? 0;
    const sortBy: RankingSortKey = body.sort_by ?? 'p50';

    // Validate baseline_index
    if (baselineIndex < 0 || baselineIndex >= results.length) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `baseline_index ${baselineIndex} is out of range (0-${results.length - 1})`,
        fields: { field: 'baseline_index' },
      });
    }

    // Get baseline result for comparisons
    const baselineResult = results[baselineIndex];
    const baselineGraph = scenarios[baselineIndex]?.graph;

    // Compute node-level sensitivity for each result
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const scenario = scenarios[i];
      if (!result.summary || !scenario) continue;

      // Compute edge sensitivity and aggregate to node level
      const edgeSensitivity = computeSensitivityAll(scenario.graph.edges, outcome_node);
      result.sensitivity_by_node = getTopNodeSensitivity(edgeSensitivity, scenario.graph.nodes, 5);
    }

    // Compute change attribution for non-baseline scenarios
    if (includeChangeAttribution && baselineResult?.summary && baselineGraph) {
      for (let i = 0; i < results.length; i++) {
        if (i === baselineIndex) continue; // Skip baseline

        const result = results[i];
        const delta = body.deltas[i];
        if (!result.summary || !delta) continue;

        const attribution = buildChangeAttributionFromDelta(
          baselineGraph,
          delta,
          baselineResult.summary.p50,
          result.summary.p50
        );

        result.delta_from_baseline = {
          p10: Math.round((result.summary.p10 - baselineResult.summary.p10) * 1000) / 1000,
          p50: Math.round((result.summary.p50 - baselineResult.summary.p50) * 1000) / 1000,
          p90: Math.round((result.summary.p90 - baselineResult.summary.p90) * 1000) / 1000,
          change_attribution: attribution,
        };
      }
    }

    // Compute rankings
    let rankingSummary: RankingSummary | undefined;
    if (includeRanking) {
      // Filter to valid results: must have summary AND no inference error
      // Errored scenarios get fallback summaries but should not win rankings
      const validResults = results.filter((r: any) => r.summary !== null && !r.error);
      const sortedResults = [...validResults].sort((a: any, b: any) => {
        return b.summary[sortBy] - a.summary[sortBy];
      });

      // Assign ranks to all results (errored scenarios get rank but can't win)
      for (const result of results) {
        if (result.summary === null || result.error) {
          result.rank = null;
          continue;
        }
        const sortedIndex = sortedResults.findIndex((r: any) => r.label === result.label);
        result.rank = sortedIndex + 1;
        result.success_probability = result.summary[sortBy];
      }

      // Build ranking summary
      const winner = sortedResults[0];
      const runnerUp = sortedResults[1];
      // Exclude scenarios with no summary OR with inference errors
      const excludedLabels = results
        .filter((r: any) => r.summary === null || r.error)
        .map((r: any) => r.label);

      const margin = winner && runnerUp
        ? Math.round((winner.summary[sortBy] - runnerUp.summary[sortBy]) * 1000) / 1000
        : null;

      const marginPct = margin !== null && runnerUp
        ? Math.round((margin / runnerUp.summary[sortBy]) * 10000) / 100
        : null;

      rankingSummary = {
        winner: winner?.label ?? '',
        winner_p50: winner?.summary?.p50 ?? 0,
        margin,
        margin_pct: marginPct,
        ranking_confidence: computeRankingConfidence(sortedResults),
        ranked_count: validResults.length,
        excluded: excludedLabels,
        winner_dominant: isWinnerDominant(sortedResults),
      };
    }

    // === PHASE 1 CRITICAL FIXES ===

    // Task 1.7: Baseline identification
    // Single source of truth: baseline_index (explicit from request, defaults to 0)
    // baselineResult is already computed above at line ~492
    const baselineLabel = baselineResult?.label ?? null;

    // Task 1.7: Compute delta_vs_baseline for each result
    if (baselineLabel) {
      const deltasVsBaseline = computeDeltasVsBaseline(results as RankableResult[], baselineLabel);
      for (const result of results) {
        const delta = deltasVsBaseline.get(result.label);
        if (delta) {
          result.delta_vs_baseline = delta;
        }
      }
    }

    // Task 1.3: Constraint status (currently using empty status - constraints evaluated at validation stage)
    // Future: integrate with node-level constraint tracking during inference
    const constraintStatus: ConstraintStatus = emptyConstraintStatus();

    // Task 1.6: Result coherence validation
    const coherenceWarnings: CoherenceWarning[] = validateCoherence(
      results as RankableResult[],
      baselineLabel,
      {
        close_race_threshold: 0.02, // 2% margin
        high_uncertainty_threshold: 0.5, // 50% spread/p50 ratio
        baseline_value: body.baseline_value ?? 0,
      }
    );

    // === END PHASE 1 CRITICAL FIXES ===

    // Phase 3: Task 4.3 - Edge function sensitivity analysis
    // Test if results are sensitive to edge function type choices
    // Note: These warnings are returned in a separate field for schema clarity
    const edgeFunctionWarnings: CoherenceWarning[] = [];
    if (scenarios.length > 0 && outcome_node && shouldAnalyzeEdgeFunctionSensitivity(scenarios[0].graph)) {
      const topResult = results.find((r: any) => r.rank === 1);
      if (topResult?.summary?.p50) {
        const sensitivityResult = analyzeEdgeFunctionSensitivity(
          scenarios[0].graph,
          outcome_node,
          topResult.summary.p50,
          {
            top_n_edges: 3,
            significance_threshold: 0.05,
          }
        );
        // Store edge function warnings separately for cleaner client consumption
        edgeFunctionWarnings.push(...sensitivityResult.warnings);
      }
    }

    const duration = Date.now() - start;
    req.log.info({ 
      evt: 'run_bundle', 
      id: req.id, 
      route: '/v1/run_bundle',
      base_nodes: body.base_graph.nodes.length,
      base_edges: baseEdges.length,
      deltas: body.deltas.length,
      unique_results: seenHashes.size,
      evidence_count: body.evidence ? body.evidence.length : 0,
      seed,
      duration_ms: duration
    });
    
    // Record audit event
    const bundleHash = createHash('sha256')
      .update(JSON.stringify(results))
      .digest('hex')
      .slice(0, 16);
    
    recordAuditEvent({
      evt: 'run_bundle',
      route: '/v1/run_bundle',
      id: req.id,
      seed,
      response_hash: bundleHash,
      status: 200,
      ts: new Date().toISOString()
    });
    
    // Count fallback scenarios for visibility
    const fallbackCount = inferenceResults.filter((ir) => !ir.success).length;
    const allSucceeded = fallbackCount === 0;

    // Phase 1: Build utility suggestion if applicable
    let utilitySuggestion: UtilitySuggestion | undefined;
    if (rankingMode === 'simple' && includeRanking) {
      const suggestion = shouldSuggestUtilityMode(detectedOutcomeNodes);
      if (suggestion.applicable) {
        utilitySuggestion = {
          message: suggestion.message,
          applicable: true,
          outcome_nodes: detectedOutcomeNodes,
        };
      }
    }

    // Phase 2: Build response warnings from edge type inference
    const responseWarnings: ResponseWarning[] = [];

    // P0: Add experimental utility mode warning
    if (utilityModeExperimental) {
      responseWarnings.push({
        code: 'UTILITY_MODE_EXPERIMENTAL',
        message: 'ranking_mode="utility" is experimental; ranking uses sort_by fallback (weighted multi-outcome aggregation not yet implemented)',
        severity: 'warning',
      });
    }

    if (edgeTypeInferredCount > 0) {
      responseWarnings.push({
        code: 'EDGE_TYPE_INFERRED',
        message: `${edgeTypeInferredCount} edge(s) had types inferred from node kinds`,
        affected_ids: edgeTypeWarnings.map((w) => w.edge_id),
        severity: 'info',
      });
    }

    // Phase 2: Build edge type inference summary
    let edgeTypeInferenceSummary: EdgeTypeInferenceSummary | undefined;
    if (edgeTypeExplicitCount > 0 || edgeTypeInferredCount > 0) {
      edgeTypeInferenceSummary = {
        explicit_count: edgeTypeExplicitCount,
        inferred_count: edgeTypeInferredCount,
        ...(edgeTypeInferredCount > 0 && {
          inferred_edges: edgeTypeWarnings.map((w) => ({
            edge_id: w.edge_id,
            inferred_type: w.inferred_type,
          })),
        }),
      };
    }

    // Log edge type inference for observability
    if (edgeTypeInferredCount > 0) {
      req.log.info({
        evt: 'edge_type_inference',
        id: req.id,
        explicit_count: edgeTypeExplicitCount,
        inferred_count: edgeTypeInferredCount,
        inferred_edges: edgeTypeWarnings.map((w) => ({
          edge_id: w.edge_id,
          from_kind: scenarios[0]?.graph.nodes.find((n: any) => n.id === w.from)?.kind,
          to_kind: scenarios[0]?.graph.nodes.find((n: any) => n.id === w.to)?.kind,
          inferred_type: w.inferred_type,
        })),
      });
    }

    // Stream D: FactObjectV1 assembly (feature-flagged, backward-compatible)
    let factsEnvelope: FactsEnvelope | undefined;
    if (FLAGS.ENABLE_FACTS_ASSEMBLY) {
      const graphHashForLineage = createHash('sha256')
        .update(JSON.stringify({ nodes: body.base_graph.nodes, edges: baseEdges }))
        .digest('hex')
        .slice(0, 16);

      const lineage: FactLineage = {
        graph_hash: graphHashForLineage,
        seed,
        config_version: '1',
        isl_request_id: String(req.id),
      };

      factsEnvelope = assembleFactsFromBundleResults(results, lineage);
    }

    // Stream D: Review pass — deterministic cards (feature-flagged, backward-compatible)
    let preAnalysisReview: ReviewPassEnvelopeV1 | undefined;
    let postAnalysisReview: ReviewPassEnvelopeV1 | undefined;
    if (FLAGS.ENABLE_REVIEW_PASS) {
      // Pre-analysis: normalize first (map confidence/probability→belief) to match /v1/validate
      const normalizedBase = normalizeGraph(
        { nodes: body.base_graph.nodes, edges: baseEdges },
        false,
      );
      const graphViolations = computeGraphViolations(
        normalizedBase.nodes,
        normalizedBase.edges,
      );
      preAnalysisReview = generatePreAnalysisReview(graphViolations);

      // Post-analysis: map facts to cards (requires facts assembly)
      if (factsEnvelope) {
        postAnalysisReview = generatePostAnalysisReview(factsEnvelope.facts);
      }
    }

    const response: any = {
      schema: 'run_bundle.v1',
      results,
      ...(rankingSummary && { ranking_summary: rankingSummary }),
      // Phase 1: Decision support metadata
      ...(includeRanking && { ranking_mode_used: rankingMode }),
      ...(includeRanking && outcome_node && { primary_outcome_used: outcome_node }),
      ...(includeRanking && primaryOutcomeDetected && { primary_outcome_detected: true }),
      ...(utilitySuggestion && { utility_suggestion: utilitySuggestion }),
      // Phase 2: Edge type inference and warnings
      ...(responseWarnings.length > 0 && { warnings: responseWarnings }),
      ...(edgeTypeInferenceSummary && { edge_type_inference: edgeTypeInferenceSummary }),
      // Phase 1 Critical Fixes: Constraint status (omit when empty), coherence warnings, baseline identification
      ...((constraintStatus.violations.length > 0 || constraintStatus.active_constraints.length > 0) && { constraint_status: constraintStatus }),
      ...(coherenceWarnings.length > 0 && { coherence_warnings: coherenceWarnings }),
      // Phase 3: Edge function sensitivity warnings (separate from coherence for schema clarity)
      ...(edgeFunctionWarnings.length > 0 && { edge_function_warnings: edgeFunctionWarnings }),
      // Stream D: Optional FactObjectV1 envelope (backward-compatible)
      ...(factsEnvelope && { facts: factsEnvelope }),
      // Stream D: Optional review pass envelopes (backward-compatible)
      ...(preAnalysisReview && preAnalysisReview.cards.length > 0 && { pre_analysis_review: preAnalysisReview }),
      ...(postAnalysisReview && postAnalysisReview.cards.length > 0 && { post_analysis_review: postAnalysisReview }),
      // baseline_label in meta only (single source of truth)
      model_card: {
        seed,
        detail_level,
        backend: 'scm_lite',
        response_hash: bundleHash,
      },
      meta: {
        seed,
        total_scenarios: body.deltas.length,
        unique_results: seenHashes.size,
        inference_mode: allSucceeded ? 'model_based' : 'mixed',
        all_scenarios_succeeded: allSucceeded,
        ...(fallbackCount > 0 && { fallback_count: fallbackCount }),
        // Enhanced meta fields
        baseline_label: baselineResult?.label,
        baseline_index: baselineIndex,
        // Stream D feature flags — lets consumers know which optional features are active
        feature_flags: {
          facts_assembly: FLAGS.ENABLE_FACTS_ASSEMBLY,
          review_pass: FLAGS.ENABLE_REVIEW_PASS,
        },
      },
    };

    // Add sanitized evidence if present
    if (body.evidence && body.evidence.length > 0) {
      const { sanitizeEvidence } = await import('../../lib/validate-evidence.js');
      response.meta.evidence_applied = sanitizeEvidence(body.evidence);
    }

    return reply.code(200).send(response);
  });
}

/**
 * Apply delta to base graph (merge nodes and edges)
 */
function applyDelta(baseGraph: any, delta: GraphDelta): { nodes: any[]; edges: any[] } {
  // Start with base graph
  const nodeMap = new Map(baseGraph.nodes.map((n: any) => [n.id, { ...n }]));
  
  // Apply node deltas (override or add)
  const deltaNodes = Array.isArray(delta.nodes) ? delta.nodes : [];
  for (const deltaNode of deltaNodes) {
      if (nodeMap.has(deltaNode.id)) {
        // Merge with existing node
        const existing = nodeMap.get(deltaNode.id)!;
        nodeMap.set(deltaNode.id, { ...existing, ...deltaNode });
      } else {
        // Add new node
        nodeMap.set(deltaNode.id, { ...deltaNode });
      }
    }
  
  // Edges: use delta edges if provided, otherwise use base
  const deltaEdges = Array.isArray(delta.edges) ? delta.edges : [];
  const baseEdges = Array.isArray(baseGraph.edges) ? baseGraph.edges : [];
  const edges = delta.edges !== undefined 
    ? deltaEdges.map((e: any) => ({ ...e }))
    : baseEdges.map((e: any) => ({ ...e }));
  
  return {
    nodes: Array.from(nodeMap.values()),
    edges
  };
}
