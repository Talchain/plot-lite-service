/**
 * POST /v2/run - Option Comparison Mode
 *
 * V2 endpoint with canonical option-comparison model:
 * - Options are intervention bundles (not graph nodes)
 * - Strict preflight validation with BLOCKER critiques
 * - No intervention synthesis - require explicit interventions
 * - Option/decision nodes filtered from graph before analysis
 *
 * P0 Changes:
 * - Seed: accepts string OR number, normalizes to string, echoes seed_used as string
 * - Status vocabulary: per-feature uses computed|unavailable|skipped|error
 * - Top-level analysis_status: computed|partial|failed (HTTP 200) or blocked (HTTP 422)
 * - 422: Returns unwrapped V2RunError (NOT error.v1 envelope)
 * - response_hash: Computed from semantic fields only
 *
 * @see Integration Alignment Implementation Brief v1.1
 * @see P0-PLOT Workstream
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  RunRequestV3,
  RunResponseV3,
  OptionV3,
  CritiqueV3,
  EngineGraphV3,
  PerFeatureStatus,
  TopLevelAnalysisStatus,
  V2RunError,
} from '../../types/engine-v3.js';
import { DEFAULT_SEED } from '../../types/engine-v3.js';
import { normaliseGraph, NormalisationError } from '../../normalisation/graph-normaliser.js';
import { filterOptionNodes } from '../../normalisation/option-filter.js';
import { hashRequest } from '../../normalisation/canonicalise.js';
import { runPreflightValidation } from '../../validation/preflight-v2.js';
import { toISLRobustnessRequest, validateISLRequest } from '../../integrations/isl/translator-v3.js';
import {
  createPreflightLog,
  createISLRequestLog,
  addISLResponseToLog,
  logPreflight,
  logISLCall,
} from '../../logging/preflight-logger.js';
import { getISLService } from '../../integrations/isl/index.js';
import { ISLHttpError } from '../../integrations/isl/errors.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PREFLIGHT_VERSION_VALUE = '2025-12-26';
const DEFAULT_N_SAMPLES = 1000;
const BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10MB

// -----------------------------------------------------------------------------
// Seed Handling
// -----------------------------------------------------------------------------

/**
 * Normalize seed to string format.
 * Accepts string (canonical) or number (legacy).
 */
function normalizeSeed(seed: string | number | undefined): string {
  if (seed === undefined || seed === null) {
    return DEFAULT_SEED;
  }
  return String(seed);
}

// -----------------------------------------------------------------------------
// Intervention Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize interventions to support both spec-compliant simple numbers
 * and rich object format.
 *
 * Accepts:
 * - Simple: { "factor_price": 10 }
 * - Rich: { "factor_price": { "value": 10, "source": "user" } }
 *
 * Normalizes to:
 * - { "factor_price": { "value": 10, "source": "user_specified" } }
 */
function normalizeInterventions(
  interventions: Record<string, number | { value: number; source?: string }>
): Record<string, { value: number; source: 'user_specified' | 'brief_extraction' | 'cee_hypothesis' }> {
  const result: Record<string, { value: number; source: 'user_specified' | 'brief_extraction' | 'cee_hypothesis' }> = {};

  for (const [nodeId, intervention] of Object.entries(interventions ?? {})) {
    if (typeof intervention === 'number') {
      // Simple number → wrap in object with default source
      result[nodeId] = { value: intervention, source: 'user_specified' };
    } else if (intervention && typeof intervention === 'object' && 'value' in intervention) {
      // Already rich object - normalize source
      const source = intervention.source;
      const validSource = (source === 'brief_extraction' || source === 'cee_hypothesis')
        ? source
        : 'user_specified';
      result[nodeId] = { value: intervention.value, source: validSource };
    }
    // Skip invalid entries (will be caught by validation)
  }

  return result;
}

/**
 * Normalize all options' interventions.
 */
function normalizeOptions(
  options: Array<{ id: string; label: string; interventions: Record<string, any> }>
): OptionV3[] {
  return options.map(opt => ({
    id: opt.id,
    label: opt.label,
    interventions: normalizeInterventions(opt.interventions),
  }));
}

// -----------------------------------------------------------------------------
// Request Validation Schema
// -----------------------------------------------------------------------------

const runV3Schema = {
  body: {
    type: 'object',
    required: ['graph', 'options', 'goal_node_id'],
    properties: {
      graph: {
        type: 'object',
        required: ['nodes', 'edges'],
        properties: {
          nodes: { type: 'array' },
          edges: { type: 'array' },
        },
      },
      options: {
        type: 'array',
        minItems: 2,  // Minimum 2 options for comparison
        items: {
          type: 'object',
          required: ['id', 'label', 'interventions'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            interventions: { type: 'object' },
          },
        },
      },
      goal_node_id: { type: 'string', minLength: 1 },
      seed: { type: ['string', 'number', 'integer'] },
      n_samples: { type: 'number', minimum: 100, maximum: 10000 },
      detail_level: { type: 'string', enum: ['quick', 'standard', 'deep'] },
      request_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    },
  },
};

// -----------------------------------------------------------------------------
// Status Mapping
// -----------------------------------------------------------------------------

/**
 * Map ISL status to UI vocabulary per-feature status.
 *
 * Data presence takes precedence: if hasData=false, the feature is unavailable
 * regardless of what ISL claims. This prevents returning "computed" with empty results.
 */
function mapToPerFeatureStatus(islStatus: string | undefined, hasData: boolean): PerFeatureStatus {
  // Data presence is authoritative - if we have data, it's computed
  if (hasData) return 'computed';

  // No data: only trust ISL for explicit skip/fail semantics
  switch (islStatus) {
    case 'failed':
      return 'error';
    case 'skipped':
      return 'skipped';
    default:
      // No data = unavailable, even if ISL says 'computed'
      return 'unavailable';
  }
}

/**
 * Determine top-level analysis status from per-feature statuses.
 *
 * Semantics:
 * - computed: ALL features computed successfully
 * - partial: Options computed with usable outcomes; some secondary features degraded
 * - failed: No usable option outcomes (primary deliverable missing)
 *
 * Key insight: A run is "partial" if options have usable outcomes, even if secondary
 * features error. This preserves value for the user.
 */
function determineTopLevelStatus(
  optionStatus: PerFeatureStatus,
  robustnessStatus: PerFeatureStatus,
  driversStatus: PerFeatureStatus,
  optionOutcomes?: Array<{ option_id: string; expected_outcome?: number }>
): TopLevelAnalysisStatus {
  const statuses = [optionStatus, robustnessStatus, driversStatus];

  // All computed → computed
  if (statuses.every(s => s === 'computed')) {
    return 'computed';
  }

  // Check if options have usable outcomes (primary deliverable)
  const hasUsableOptions = optionStatus === 'computed' &&
    optionOutcomes &&
    optionOutcomes.length > 0 &&
    optionOutcomes.some(o => o.expected_outcome !== undefined && Number.isFinite(o.expected_outcome));

  // Options usable → partial (even if secondary features error)
  if (hasUsableOptions) {
    return 'partial';
  }

  // Mix of computed and unavailable/skipped (without usable options) → partial
  if (statuses.some(s => s === 'computed') && !statuses.some(s => s === 'error')) {
    return 'partial';
  }

  // Options not computed or all features unavailable/error → failed
  return 'failed';
}

// -----------------------------------------------------------------------------
// Response Builders
// -----------------------------------------------------------------------------

interface MetaParams {
  seedUsed: string;
  nSamples: number;
  detailLevel: string;
  latencyMs: number;
  normalizationMs?: number;
  validationMs?: number;
  islMs?: number;
}

/**
 * Build a 422 blocked response (V2RunError).
 * NOT wrapped in error.v1 envelope.
 */
function buildBlockedResponse(
  statusReason: string,
  critiques: CritiqueV3[]
): V2RunError {
  return {
    analysis_status: 'blocked',
    status_reason: statusReason,
    critiques,
  };
}

/**
 * Build a success/partial/failed response (HTTP 200).
 */
function buildResponse(
  requestId: string,
  analysisStatus: TopLevelAnalysisStatus,
  statusReason: string | undefined,
  optionComparisonStatus: PerFeatureStatus,
  robustnessStatus: PerFeatureStatus,
  driversStatus: PerFeatureStatus,
  critiques: CritiqueV3[],
  meta: MetaParams,
  responseHash: string | undefined,
  islResult?: any,
  options?: OptionV3[],
  islAnalysisStatus?: string,
  islStatusReason?: string
): RunResponseV3 {
  // Map ISL results to response format
  const optionComparison = islResult?.results?.map((r: any) => {
    const option = options?.find((o) => o.id === r.option_id);
    return {
      option_id: r.option_id,
      option_label: option?.label ?? r.option_id,
      expected_outcome: r.expected_outcome,
      confidence_interval: r.confidence_interval ?? [0, 0],
      probability_of_goal: r.probability_of_goal,
    };
  });

  const edgeSensitivity = islResult?.sensitivity?.map((s: any) => ({
    edge_id: `${s.edge_from}::${s.edge_to}`,
    from: s.edge_from,
    to: s.edge_to,
    sensitivity_type: s.sensitivity_type,
    elasticity: s.elasticity,
    importance_rank: s.importance_rank,
    interpretation: s.interpretation,
  }));

  const factorSensitivity = islResult?.factor_sensitivity?.map((f: any) => ({
    factor_id: f.node_id,
    sensitivity_score: f.sensitivity,
    value_of_information: f.value_of_information,
    direction: f.direction,
  }));

  const robustness = islResult?.robustness
    ? {
        score: islResult.robustness.score,
        label: islResult.robustness.label,
        fragile_edges: islResult.robustness.fragile_edges,
        robust_edges: islResult.robustness.robust_edges,
        explanation: islResult.robustness.explanation,
      }
    : undefined;

  return {
    request_schema_version: 'v3',
    endpoint_version: 'v2/run',
    preflight_version: PREFLIGHT_VERSION_VALUE,
    request_id: requestId,

    analysis_status: analysisStatus,
    status_reason: statusReason,

    option_comparison_status: optionComparisonStatus,
    robustness_status: robustnessStatus,
    drivers_status: driversStatus,

    isl_analysis_status: islAnalysisStatus,
    isl_status_reason: islStatusReason,

    critiques,
    option_comparison: optionComparison,
    edge_sensitivity: edgeSensitivity,
    factor_sensitivity: factorSensitivity,
    robustness,
    response_hash: responseHash,

    meta: {
      seed_used: meta.seedUsed,
      n_samples: meta.nSamples,
      detail_level: meta.detailLevel,
      latency_ms: meta.latencyMs,
      normalization_ms: meta.normalizationMs,
      validation_ms: meta.validationMs,
      isl_ms: meta.islMs,
    },
  };
}

// -----------------------------------------------------------------------------
// ISL Critique Mapping
// -----------------------------------------------------------------------------

/**
 * Map ISL critiques to V2 critique format.
 */
function mapISLCritiquesToV2(islCritiques: Array<{
  code: string;
  severity: string;
  message: string;
  suggestion?: string;
  affected_nodes?: string[];
}>): CritiqueV3[] {
  return islCritiques.map((c) => ({
    id: randomUUID(),
    code: c.code,
    severity: c.severity === 'blocker' ? 'blocker' :
              c.severity === 'error' ? 'error' :
              c.severity === 'warning' ? 'warning' : 'info',
    message: c.suggestion ? `${c.message} ${c.suggestion}` : c.message,
    source: 'isl' as const,
    affected_node_ids: c.affected_nodes,
    blocks_analysis: c.severity === 'blocker',
  }));
}

// -----------------------------------------------------------------------------
// Route Registration
// -----------------------------------------------------------------------------

export async function registerRunV2Route(app: FastifyInstance): Promise<void> {
  app.post(
    '/v2/run',
    {
      schema: runV3Schema,
      bodyLimit: BODY_LIMIT_BYTES,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = performance.now();
      const body = req.body as RunRequestV3;
      const requestId = body.request_id ?? String(req.id) ?? randomUUID();
      const seedUsed = normalizeSeed(body.seed);
      const nSamples = body.n_samples ?? DEFAULT_N_SAMPLES;
      const detailLevel = body.detail_level ?? 'standard';

      // Timing tracking
      let normalizationMs = 0;
      let validationMs = 0;
      let islMs = 0;

      try {
        // =================================================================
        // Phase 1: Normalization
        // =================================================================
        const normStart = performance.now();

        let normalizedGraph: EngineGraphV3;
        let nodesNormalised = 0;
        let edgesNormalised = 0;
        let normWarnings: string[] = [];

        // Normalize options (support both simple numbers and rich objects)
        const normalizedOptions = normalizeOptions(body.options);

        try {
          const result = normaliseGraph(body.graph);
          normalizedGraph = result.graph;
          nodesNormalised = result.nodesNormalised;
          edgesNormalised = result.edgesNormalised;
          normWarnings = result.warnings;
        } catch (err) {
          if (err instanceof NormalisationError) {
            // Return 422 with V2RunError for normalization failures
            return reply.status(422).send(buildBlockedResponse(
              `Normalization failed: ${err.message}`,
              [{
                id: randomUUID(),
                code: 'NORMALIZATION_ERROR',
                severity: 'blocker',
                message: err.message,
                source: 'validation',
                affected_node_ids: err.nodeId ? [err.nodeId] : undefined,
                blocks_analysis: true,
              }]
            ));
          }
          throw err;
        }

        // Filter non-causal nodes (option, decision)
        const filterResult = filterOptionNodes(normalizedGraph);
        const filteredGraph = filterResult.filteredGraph;

        // Log if option nodes were filtered
        if (filterResult.removedNodeIds.size > 0) {
          console.log(
            JSON.stringify({
              event: 'non_causal_nodes_filtered',
              request_id: requestId,
              removed_count: filterResult.removedNodeIds.size,
              removed_edge_count: filterResult.removedEdgeCount,
              removed_node_ids: Array.from(filterResult.removedNodeIds),
            })
          );
        }

        // =================================================================
        // Phase 1b: Early Goal Validation (before filtering)
        // =================================================================
        // Validate goal in ORIGINAL graph before filtering to give specific errors
        const NON_CAUSAL_NODE_KINDS = ['option', 'decision'];

        if (!body.goal_node_id || body.goal_node_id.trim() === '') {
          return reply.status(422).send(buildBlockedResponse(
            'Goal node is required',
            [{
              id: randomUUID(),
              code: 'MISSING_GOAL_NODE',
              severity: 'blocker',
              message: 'Goal node is required for option comparison. Please select a goal node.',
              source: 'validation',
              blocks_analysis: true,
            }]
          ));
        }

        // Check goal exists in original normalized graph (before filtering)
        const goalNode = normalizedGraph.nodes.find(n => n.id === body.goal_node_id);

        if (!goalNode) {
          return reply.status(422).send(buildBlockedResponse(
            `Goal node "${body.goal_node_id}" not found in graph`,
            [{
              id: randomUUID(),
              code: 'GOAL_NODE_NOT_IN_GRAPH',
              severity: 'blocker',
              message: `Goal node "${body.goal_node_id}" not found in graph. Select an existing node as the goal, or add the goal node to the graph.`,
              source: 'validation',
              affected_node_ids: [body.goal_node_id],
              blocks_analysis: true,
            }]
          ));
        }

        // Check if goal is a non-causal kind (would be filtered out)
        if (NON_CAUSAL_NODE_KINDS.includes(goalNode.kind)) {
          return reply.status(422).send(buildBlockedResponse(
            `Goal node "${body.goal_node_id}" is a ${goalNode.kind} node`,
            [{
              id: randomUUID(),
              code: 'GOAL_NODE_NOT_CAUSAL',
              severity: 'blocker',
              message: `Goal node "${body.goal_node_id}" is a ${goalNode.kind} node, which cannot be used as an analysis target. Select a factor, outcome, risk, or goal node as the analysis target.`,
              source: 'validation',
              affected_node_ids: [body.goal_node_id],
              blocks_analysis: true,
            }]
          ));
        }

        normalizationMs = performance.now() - normStart;

        // =================================================================
        // Phase 2: Preflight Validation
        // =================================================================
        const valStart = performance.now();

        const preflight = runPreflightValidation(
          filteredGraph,
          normalizedOptions,
          body.goal_node_id,
          {
            optionNodesFiltered: filterResult.removedNodeIds.size,
            optionEdgesFiltered: filterResult.removedEdgeCount,
            nodesNormalised,
            edgesNormalised,
          }
        );

        validationMs = performance.now() - valStart;

        // Log preflight result
        const preflightLog = createPreflightLog(
          requestId,
          body.goal_node_id,
          preflight,
          validationMs
        );
        logPreflight(preflightLog);

        // If preflight failed, return 422 with V2RunError
        if (!preflight.passed) {
          return reply.status(422).send(buildBlockedResponse(
            'Preflight validation failed',
            preflight.blockers
          ));
        }

        // =================================================================
        // Phase 3: Compute Response Hash
        // =================================================================
        const responseHash = hashRequest(body, filteredGraph, seedUsed);

        // =================================================================
        // Phase 4: ISL Call
        // =================================================================
        const islStart = performance.now();

        const islService = getISLService();

        if (!islService.isEnabled()) {
          const totalMs = performance.now() - startTime;

          return reply.send(buildResponse(
            requestId,
            'failed',
            'ISL service is not enabled',
            'unavailable',
            'unavailable',
            'unavailable',
            [{
              id: randomUUID(),
              code: 'ISL_NOT_ENABLED',
              severity: 'warning',
              message: 'ISL service is not enabled. Analysis unavailable.',
              source: 'validation',
              blocks_analysis: false,
            }],
            {
              seedUsed,
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
            },
            responseHash
          ));
        }

        // Build ISL request
        const islRequest = toISLRobustnessRequest(
          filteredGraph,
          normalizedOptions,
          body.goal_node_id,
          requestId,
          nSamples
        );

        // Validate ISL request (should never fail after preflight, but defensive)
        const islValidationErrors = validateISLRequest(islRequest);
        if (islValidationErrors.length > 0) {
          console.error(
            JSON.stringify({
              event: 'isl_request_validation_failed',
              request_id: requestId,
              errors: islValidationErrors,
            })
          );

          return reply.status(422).send(buildBlockedResponse(
            'ISL request validation failed',
            islValidationErrors.map((msg) => ({
              id: randomUUID(),
              code: 'ISL_REQUEST_INVALID',
              severity: 'blocker' as const,
              message: msg,
              source: 'validation' as const,
              blocks_analysis: true,
            }))
          ));
        }

        // Log ISL request
        const islReqLog = createISLRequestLog(
          requestId,
          filteredGraph.nodes.length,
          filteredGraph.edges.length,
          normalizedOptions.length,
          normalizedOptions.map((o) => Object.keys(o.interventions).length),
          body.goal_node_id
        );

        // Call ISL
        let islResult: any;
        let islSuccess = false;
        let islStatusCode = 0;
        let islError: ISLHttpError | undefined;

        try {
          const response = await islService.callAnalysisEndpoint<any>(
            '/api/v1/robustness/analyze/v2',
            islRequest,
            requestId
          );

          if (response.data) {
            islResult = response.data;
            islSuccess = true;
            islStatusCode = 200;
          } else {
            islStatusCode = 500;
            console.error(
              JSON.stringify({
                event: 'isl_call_failed',
                request_id: requestId,
                error: response.error?.message ?? 'Unknown error',
                error_code: response.error?.code,
              })
            );
          }
        } catch (err) {
          if (err instanceof ISLHttpError) {
            islError = err;
            islStatusCode = err.status;

            // Handle 422 from ISL with structured critiques (V2, V1, or Pydantic format)
            if (err.is422()) {
              console.log(
                JSON.stringify({
                  event: 'isl_422_received',
                  request_id: requestId,
                  format: err.isV2Format() ? 'v2' : 'legacy',
                  message: err.getErrorMessage(),
                  critiques_count: err.getCritiques().length,
                })
              );
            }
          } else {
            islStatusCode = 500;
          }

          console.error(
            JSON.stringify({
              event: 'isl_call_failed',
              request_id: requestId,
              error: (err as Error).message,
              status: islStatusCode,
            })
          );
        }

        islMs = performance.now() - islStart;

        // Log ISL response
        const islRespLog = addISLResponseToLog(
          islReqLog,
          islStatusCode,
          islMs,
          islSuccess,
          islSuccess ? undefined : { code: 'ISL_ERROR' }
        );
        logISLCall(islRespLog);

        // Build response
        const totalMs = performance.now() - startTime;
        const critiques: CritiqueV3[] = [...preflight.warnings];

        // Log normalization warnings with structured context for telemetry
        if (normWarnings.length > 0) {
          console.log(
            JSON.stringify({
              event: 'normalisation_warnings',
              request_id: requestId,
              warning_count: normWarnings.length,
              warnings: normWarnings,
              graph_stats: {
                node_count: body.graph.nodes?.length ?? 0,
                edge_count: body.graph.edges?.length ?? 0,
                option_count: normalizedOptions.length,
              },
            })
          );
        }

        // Add normalization warnings as info critiques
        for (const warning of normWarnings) {
          critiques.push({
            id: randomUUID(),
            code: 'NORMALIZATION_WARNING',
            severity: 'info',
            message: warning,
            source: 'validation',
            blocks_analysis: false,
          });
        }

        // Handle ISL 422 with structured critiques (V2, V1, or Pydantic format)
        if (islError?.is422()) {
          const islCritiques = mapISLCritiquesToV2(islError.getCritiques());
          critiques.push(...islCritiques);

          return reply.status(422).send(buildBlockedResponse(
            islError.getErrorMessage(),
            critiques
          ));
        }

        // Handle ISL failure (non-422)
        if (!islSuccess) {
          critiques.push({
            id: randomUUID(),
            code: 'ISL_CALL_FAILED',
            severity: 'error',
            message: 'ISL analysis failed. Please try again.',
            source: 'isl',
            blocks_analysis: false,
          });

          return reply.send(buildResponse(
            requestId,
            'failed',
            'ISL analysis failed',
            'error',
            'error',
            'error',
            critiques,
            {
              seedUsed,
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
              islMs,
            },
            responseHash
          ));
        }

        // Handle HTTP 200 with analysis_status='failed' from ISL
        const islAnalysisStatus = islResult.analysis_status;
        const islStatusReason = islResult.status_reason;

        if (islAnalysisStatus === 'failed') {
          return reply.send(buildResponse(
            requestId,
            'failed',
            islStatusReason || 'ISL analysis failed',
            'error',
            'error',
            'error',
            critiques,
            {
              seedUsed,
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
              islMs,
            },
            responseHash,
            islResult,
            normalizedOptions,
            islAnalysisStatus,
            islStatusReason
          ));
        }

        // Compute per-feature statuses
        const hasOptionComparison = islResult.results?.length > 0;
        // Check for meaningful robustness data (empty objects {} are truthy but have no score)
        const hasRobustness = islResult.robustness?.score !== undefined;
        const hasDrivers = islResult.sensitivity?.length > 0;

        const optionStatus = mapToPerFeatureStatus(islAnalysisStatus, hasOptionComparison);
        const robustnessStatus = mapToPerFeatureStatus(islAnalysisStatus, hasRobustness);
        const driversStatus = mapToPerFeatureStatus(islAnalysisStatus, hasDrivers);

        // Warn if ISL claims 'computed' but returned no data
        if (islAnalysisStatus === 'computed' && !hasOptionComparison && !hasRobustness && !hasDrivers) {
          critiques.push({
            id: randomUUID(),
            code: 'ISL_EMPTY_RESULTS',
            severity: 'warning',
            message: 'Analysis completed but no results available. Graph structure may prevent causal inference.',
            source: 'isl',
            blocks_analysis: false,
          });
        }

        // Extract option outcomes for status determination
        const optionOutcomes = islResult.results?.map((r: any) => ({
          option_id: r.option_id,
          expected_outcome: r.expected_outcome,
        }));

        const topLevelStatus = determineTopLevelStatus(
          optionStatus,
          robustnessStatus,
          driversStatus,
          optionOutcomes
        );

        return reply.send(buildResponse(
          requestId,
          topLevelStatus,
          topLevelStatus !== 'computed' ? (islStatusReason || 'Some analyses unavailable') : undefined,
          optionStatus,
          robustnessStatus,
          driversStatus,
          critiques,
          {
            seedUsed,
            nSamples,
            detailLevel,
            latencyMs: totalMs,
            normalizationMs,
            validationMs,
            islMs,
          },
          responseHash,
          islResult,
          normalizedOptions,
          islAnalysisStatus,
          islStatusReason
        ));
      } catch (err) {
        const totalMs = performance.now() - startTime;

        console.error(
          JSON.stringify({
            event: 'v2_run_error',
            request_id: requestId,
            error: (err as Error).message,
            stack: (err as Error).stack,
          })
        );

        // Internal errors return 500 with error.v1 envelope (NOT 422 V2RunError)
        // This distinguishes client validation errors (422) from server errors (500)
        return reply.status(500).send({
          schema: 'error.v1',
          code: 'INTERNAL',
          message: 'Internal server error',
          request_id: requestId,
          retryable: true,
        });
      }
    }
  );

  // HEAD endpoint for probing
  app.head('/v2/run', async (_req, reply) => {
    reply.header('Allow', 'POST, OPTIONS, HEAD');
    return reply.code(405).send();
  });
}
