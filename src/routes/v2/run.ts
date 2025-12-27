/**
 * POST /v2/run - Option Comparison Mode
 *
 * V2 endpoint with canonical option-comparison model:
 * - Options are intervention bundles (not graph nodes)
 * - Strict preflight validation with BLOCKER critiques
 * - No intervention synthesis - require explicit interventions
 * - Option nodes filtered from graph before analysis
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  RunRequestV3,
  RunResponseV3,
  OptionV3,
  CritiqueV3,
  EngineGraphV3,
  PREFLIGHT_VERSION,
} from '../../types/engine-v3.js';
import { normaliseGraph, NormalisationError } from '../../normalisation/graph-normaliser.js';
import { filterOptionNodes } from '../../normalisation/option-filter.js';
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
import { replyWithAppError } from '../../errors.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PREFLIGHT_VERSION_VALUE = '2025-12-26';
const DEFAULT_N_SAMPLES = 1000;
const BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10MB

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
        minItems: 1,
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
      seed: { type: 'number' },
      n_samples: { type: 'number', minimum: 100, maximum: 10000 },
      detail_level: { type: 'string', enum: ['quick', 'standard', 'deep'] },
      request_id: { type: 'string' },
      idempotency_key: { type: 'string' },
    },
  },
};

// -----------------------------------------------------------------------------
// Response Builder
// -----------------------------------------------------------------------------

/**
 * Build an unavailable response when preflight fails.
 */
function buildUnavailableResponse(
  requestId: string,
  critiques: CritiqueV3[],
  reason: string,
  meta: RunResponseV3['meta']
): RunResponseV3 {
  return {
    request_schema_version: 'v3',
    endpoint_version: 'v2/run',
    preflight_version: PREFLIGHT_VERSION_VALUE,
    request_id: requestId,

    option_comparison_status: 'unavailable',
    robustness_status: 'unavailable',
    drivers_status: 'unavailable',
    unavailable_reason: reason,

    critiques,
    meta,
  };
}

/**
 * Build a successful response with analysis results.
 */
function buildSuccessResponse(
  requestId: string,
  critiques: CritiqueV3[],
  islResult: any,
  options: OptionV3[],
  meta: RunResponseV3['meta']
): RunResponseV3 {
  // Map ISL results to response format
  const optionComparison = islResult.results?.map((r: any) => {
    const option = options.find((o) => o.id === r.option_id);
    return {
      option_id: r.option_id,
      option_label: option?.label ?? r.option_id,
      expected_outcome: r.expected_outcome,
      confidence_interval: r.confidence_interval ?? [0, 0],
      probability_of_goal: r.probability_of_goal,
    };
  });

  const edgeSensitivity = islResult.sensitivity?.map((s: any) => ({
    edge_id: `${s.edge_from}::${s.edge_to}`,
    from: s.edge_from,
    to: s.edge_to,
    sensitivity_type: s.sensitivity_type,
    elasticity: s.elasticity,
    importance_rank: s.importance_rank,
    interpretation: s.interpretation,
  }));

  const factorSensitivity = islResult.factor_sensitivity?.map((f: any) => ({
    factor_id: f.node_id,
    sensitivity_score: f.sensitivity,
    value_of_information: f.value_of_information,
    direction: f.direction,
  }));

  const robustness = islResult.robustness
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

    option_comparison_status: optionComparison?.length > 0 ? 'available' : 'unavailable',
    robustness_status: robustness ? 'available' : 'unavailable',
    drivers_status: edgeSensitivity?.length > 0 ? 'available' : 'unavailable',

    critiques,
    option_comparison: optionComparison,
    edge_sensitivity: edgeSensitivity,
    factor_sensitivity: factorSensitivity,
    robustness,
    meta,
  };
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

        try {
          const result = normaliseGraph(body.graph);
          normalizedGraph = result.graph;
          nodesNormalised = result.nodesNormalised;
          edgesNormalised = result.edgesNormalised;
          normWarnings = result.warnings;
        } catch (err) {
          if (err instanceof NormalisationError) {
            return replyWithAppError(reply, {
              type: 'BAD_INPUT',
              statusCode: 400,
              message: err.message,
              fields: { field: err.field, nodeId: err.nodeId, edgeId: err.edgeId },
            });
          }
          throw err;
        }

        // Filter option nodes
        const filterResult = filterOptionNodes(normalizedGraph);
        const filteredGraph = filterResult.filteredGraph;

        // Log if option nodes were filtered
        if (filterResult.removedNodeIds.size > 0) {
          console.log(
            JSON.stringify({
              event: 'option_nodes_filtered',
              request_id: requestId,
              removed_count: filterResult.removedNodeIds.size,
              removed_edge_count: filterResult.removedEdgeCount,
            })
          );
        }

        normalizationMs = performance.now() - normStart;

        // =================================================================
        // Phase 2: Preflight Validation
        // =================================================================
        const valStart = performance.now();

        const preflight = runPreflightValidation(
          filteredGraph,
          body.options,
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

        // If preflight failed, return unavailable response
        if (!preflight.passed) {
          const totalMs = performance.now() - startTime;

          return buildUnavailableResponse(
            requestId,
            preflight.blockers,
            'preflight_validation_failed',
            {
              seed: body.seed ?? 42,
              n_samples: body.n_samples ?? DEFAULT_N_SAMPLES,
              detail_level: body.detail_level ?? 'standard',
              latency_ms: totalMs,
              normalization_ms: normalizationMs,
              validation_ms: validationMs,
            }
          );
        }

        // =================================================================
        // Phase 3: ISL Call
        // =================================================================
        const islStart = performance.now();

        const islService = getISLService();

        if (!islService.isEnabled()) {
          const totalMs = performance.now() - startTime;

          return buildUnavailableResponse(
            requestId,
            [
              {
                id: randomUUID(),
                code: 'ISL_NOT_ENABLED',
                severity: 'warning',
                message: 'ISL service is not enabled. Analysis unavailable.',
                source: 'validation',
                blocks_analysis: false,
              },
            ],
            'isl_not_enabled',
            {
              seed: body.seed ?? 42,
              n_samples: body.n_samples ?? DEFAULT_N_SAMPLES,
              detail_level: body.detail_level ?? 'standard',
              latency_ms: totalMs,
              normalization_ms: normalizationMs,
              validation_ms: validationMs,
            }
          );
        }

        // Build ISL request
        const islRequest = toISLRobustnessRequest(
          filteredGraph,
          body.options,
          body.goal_node_id,
          requestId,
          body.n_samples ?? DEFAULT_N_SAMPLES
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

          const totalMs = performance.now() - startTime;
          return buildUnavailableResponse(
            requestId,
            islValidationErrors.map((msg) => ({
              id: randomUUID(),
              code: 'ISL_REQUEST_INVALID',
              severity: 'blocker' as const,
              message: msg,
              source: 'validation' as const,
              blocks_analysis: true,
            })),
            'isl_request_invalid',
            {
              seed: body.seed ?? 42,
              n_samples: body.n_samples ?? DEFAULT_N_SAMPLES,
              detail_level: body.detail_level ?? 'standard',
              latency_ms: totalMs,
              normalization_ms: normalizationMs,
              validation_ms: validationMs,
            }
          );
        }

        // Log ISL request
        const islReqLog = createISLRequestLog(
          requestId,
          filteredGraph.nodes.length,
          filteredGraph.edges.length,
          body.options.length,
          body.options.map((o) => Object.keys(o.interventions).length),
          body.goal_node_id
        );

        // Call ISL using the translated request format
        let islResult: any;
        let islSuccess = false;
        let islStatusCode = 0;

        try {
          // Use callAnalysisEndpoint with the translated request
          // This ensures the translator output is actually used for the ISL call
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
          islStatusCode = 500;
          console.error(
            JSON.stringify({
              event: 'isl_call_failed',
              request_id: requestId,
              error: (err as Error).message,
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

        if (!islSuccess) {
          return buildUnavailableResponse(
            requestId,
            [
              ...critiques,
              {
                id: randomUUID(),
                code: 'ISL_CALL_FAILED',
                severity: 'error',
                message: 'ISL analysis failed. Please try again.',
                source: 'isl',
                blocks_analysis: false,
              },
            ],
            'isl_call_failed',
            {
              seed: body.seed ?? 42,
              n_samples: body.n_samples ?? DEFAULT_N_SAMPLES,
              detail_level: body.detail_level ?? 'standard',
              latency_ms: totalMs,
              normalization_ms: normalizationMs,
              validation_ms: validationMs,
              isl_ms: islMs,
            }
          );
        }

        return buildSuccessResponse(
          requestId,
          critiques,
          islResult,
          body.options,
          {
            seed: body.seed ?? 42,
            n_samples: body.n_samples ?? DEFAULT_N_SAMPLES,
            detail_level: body.detail_level ?? 'standard',
            latency_ms: totalMs,
            normalization_ms: normalizationMs,
            validation_ms: validationMs,
            isl_ms: islMs,
          }
        );
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

        return replyWithAppError(reply, {
          type: 'INTERNAL',
          statusCode: 500,
          message: 'An unexpected error occurred.',
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
