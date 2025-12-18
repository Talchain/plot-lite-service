/**
 * POST /v1/analysis/optimise - Continuous Variable Optimisation Proxy
 *
 * Proxies requests to ISL /api/v1/analysis/optimise for continuous
 * decision variable optimisation using grid search and optional
 * gradient refinement.
 *
 * Different from /v1/optimise which handles discrete action selection
 * under budget constraints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { replyWithAppError } from '../../errors.js';
import { normalizeGraph } from '../../util/normalize.js';
import { inferEdgeTypes } from '../../services/ranking/edge-type-inference.js';
import { isFlagOn } from '../../cee/codes.js';
import { islService } from '../../integrations/isl/index.js';
import type {
  ContinuousOptimiseRequest,
  ContinuousOptimiseResponse,
  IslContinuousOptimiseResponse,
  OptimiseConstraint,
  ProxyError,
} from './types/proxy.types.js';
import {
  shouldAllowIslCall,
  recordIslSuccess,
  recordIslFailure,
} from '../../integrations/isl-circuit-breaker.js';

const MAX_NODES = 50;
const MAX_EDGES = 200;
const MAX_GRID_POINTS = 100;
const MAX_CONSTRAINTS = 20;
const DEFAULT_GRID_POINTS = 20;

/**
 * Compute local optimisation fallback using simple grid search
 * This is a basic fallback when ISL is unavailable
 */
function computeLocalOptimise(
  decisionVariable: string,
  searchRange: [number, number],
  objectiveDirection: 'maximise' | 'minimise',
  gridPoints: number
): IslContinuousOptimiseResponse {
  const [min, max] = searchRange;
  const step = (max - min) / Math.max(gridPoints - 1, 1);

  // Simple grid search with mock values
  const searchResults: Array<{ value: number; objective: number }> = [];
  for (let i = 0; i < gridPoints; i++) {
    const value = min + i * step;
    // Mock objective: simple parabola with max at midpoint
    const midpoint = (min + max) / 2;
    const range = max - min || 1;
    const normalizedDist = (value - midpoint) / range;
    const objective = 100 - 100 * normalizedDist * normalizedDist;
    searchResults.push({
      value: Math.round(value * 1000) / 1000,
      objective: Math.round(objective * 1000) / 1000,
    });
  }

  // Find optimal based on direction
  const sorted = [...searchResults].sort((a, b) =>
    objectiveDirection === 'maximise'
      ? b.objective - a.objective
      : a.objective - b.objective
  );
  const optimal = sorted[0] || { value: (min + max) / 2, objective: 100 };

  // Estimate confidence interval (simple heuristic: +/- 10%)
  const ci_width = (max - min) * 0.1;

  return {
    optimal_value: optimal.value,
    optimal_objective: optimal.objective,
    confidence_interval: [
      Math.round(Math.max(min, optimal.value - ci_width) * 1000) / 1000,
      Math.round(Math.min(max, optimal.value + ci_width) * 1000) / 1000,
    ],
    sensitivity: {
      gradient_at_optimum: 0,
      second_derivative: -200 / ((max - min || 1) * (max - min || 1)),
      robustness: 'medium',
    },
    search_results: searchResults,
    constraints_satisfied: true,
    active_constraints: [],
    warnings: ['Using local fallback - ISL unavailable'],
  };
}

export async function registerAnalysisOptimiseRoute(app: FastifyInstance) {
  app.post(
    '/v1/analysis/optimise',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const start = Date.now();
      const body = req.body as ContinuousOptimiseRequest;
      const requestId = String(req.id);

      // Validate required fields
      if (!body.decision_variable || typeof body.decision_variable !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'decision_variable required',
          fields: { field: 'decision_variable' },
        });
      }

      if (!body.search_range || !Array.isArray(body.search_range) || body.search_range.length !== 2) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'search_range must be [min, max] array',
          fields: { field: 'search_range' },
        });
      }

      const [rangeMin, rangeMax] = body.search_range;
      if (typeof rangeMin !== 'number' || typeof rangeMax !== 'number' || rangeMin >= rangeMax) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'search_range must be [min, max] where min < max',
          fields: { field: 'search_range' },
        });
      }

      if (!body.objective_node || typeof body.objective_node !== 'string') {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'objective_node required',
          fields: { field: 'objective_node' },
        });
      }

      // Validate graph
      if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'graph.nodes required',
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.nodes.length > MAX_NODES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_NODES} nodes`,
          fields: { field: 'graph.nodes' },
        });
      }

      if (body.graph.edges && body.graph.edges.length > MAX_EDGES) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `graph exceeds max ${MAX_EDGES} edges`,
          fields: { field: 'graph.edges' },
        });
      }

      // Validate decision variable exists in graph
      const decisionNode = body.graph.nodes.find((n: any) => n.id === body.decision_variable);
      if (!decisionNode) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `decision_variable '${body.decision_variable}' not found in graph`,
          fields: { field: 'decision_variable' },
        });
      }

      // Validate objective node exists in graph
      const objectiveNode = body.graph.nodes.find((n: any) => n.id === body.objective_node);
      if (!objectiveNode) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `objective_node '${body.objective_node}' not found in graph`,
          fields: { field: 'objective_node' },
        });
      }

      // Validate constraints count
      if (body.constraints && body.constraints.length > MAX_CONSTRAINTS) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `constraints exceeds max ${MAX_CONSTRAINTS}`,
          fields: { field: 'constraints' },
        });
      }

      // Validate grid_points
      const gridPoints = body.grid_points ?? DEFAULT_GRID_POINTS;
      if (gridPoints < 2 || gridPoints > MAX_GRID_POINTS) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `grid_points must be between 2 and ${MAX_GRID_POINTS}`,
          fields: { field: 'grid_points' },
        });
      }

      // Normalize graph and infer edge types
      const normalizedGraph = normalizeGraph(body.graph, false);
      const edgeInference = inferEdgeTypes(normalizedGraph.nodes, normalizedGraph.edges);
      const graph = {
        nodes: normalizedGraph.nodes,
        edges: edgeInference.edges,
      };

      // Prepare request parameters
      const objectiveDirection = body.objective_direction ?? 'maximise';
      const refine = body.refine ?? false;
      const confidenceLevel = body.confidence_level;

      // Call ISL if enabled
      let result: IslContinuousOptimiseResponse | null = null;
      let islError: ProxyError | undefined;
      let provenance: 'isl' | 'plot_fallback' = 'plot_fallback';

      const islEnabled = isFlagOn(
        process.env.ISL_OPTIMISE_ENABLE ?? process.env.ISL_ENABLE
      );

      if (islEnabled) {
        // Check circuit breaker before ISL call
        const cbCheck = shouldAllowIslCall();
        if (!cbCheck.allowed) {
          req.log.info({
            evt: 'analysis_optimise_circuit_breaker',
            id: requestId,
            reason: cbCheck.reason,
          });
          islError = {
            code: 'ISL_CIRCUIT_BREAKER_OPEN',
            message: cbCheck.reason || 'ISL circuit breaker is open',
            retryable: true,
          };
        } else {
          req.log.info({
            evt: 'analysis_optimise_isl_call',
            id: requestId,
            decision_variable: body.decision_variable,
            objective_node: body.objective_node,
            objective_direction: objectiveDirection,
            grid_points: gridPoints,
            refine,
          });

          const islResult = await islService.callAnalysisEndpoint<IslContinuousOptimiseResponse>(
            '/api/v1/analysis/optimise',
            {
              plot_request_id: requestId,
              decision_variable: body.decision_variable,
              search_range: body.search_range,
              objective_node: body.objective_node,
              objective_direction: objectiveDirection,
              constraints: body.constraints,
              graph,
              grid_points: gridPoints,
              refine,
              confidence_level: confidenceLevel,
            },
            requestId
          );

          result = islResult.data;
          islError = islResult.error;

          // Record result with circuit breaker
          if (result) {
            recordIslSuccess();
            provenance = 'isl';
          } else if (islError?.retryable) {
            recordIslFailure();
          }
        }
      }

      // Use local fallback if ISL unavailable
      if (!result) {
        result = computeLocalOptimise(
          body.decision_variable,
          body.search_range,
          objectiveDirection,
          gridPoints
        );
      }

      const duration = Date.now() - start;
      req.log.info({
        evt: 'analysis_optimise_complete',
        id: requestId,
        decision_variable: body.decision_variable,
        optimal_value: result.optimal_value,
        optimal_objective: result.optimal_objective,
        provenance,
        duration_ms: duration,
      });

      const response: ContinuousOptimiseResponse = {
        schema: 'continuous_optimise.v1',
        result,
        provenance,
        model_card: {
          decision_variable: body.decision_variable,
          objective_node: body.objective_node,
          objective_direction: objectiveDirection,
          search_range: body.search_range,
          grid_points: gridPoints,
          refine,
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
        ...(islError && { isl_error: islError }),
      };

      return reply.code(200).send(response);
    }
  );
}
