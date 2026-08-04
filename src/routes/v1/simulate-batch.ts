/**
 * POST /v1/simulate/batch - Batch simulation for ISL robustness analysis
 *
 * Brief 8: Task 4 - Batch Simulation API
 *
 * Efficiently runs simulations for a base graph and multiple perturbations.
 * Results are cached for future use. ISL uses this for:
 * - Sensitivity sweeps: N perturbations in one call
 * - Robustness bounds: Binary search for flip thresholds
 * - VoI calculation: Compare utility distributions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { createHash } from 'crypto';
import { replyWithAppError } from '../../errors.js';
import {
  generateTraces,
  runBatchSimulation,
  getSamplingMetrics,
} from '../../sampling/engine.js';
import { getTraceCache } from '../../sampling/trace-cache.js';
import type {
  BatchSimulationRequest,
  BatchSimulationResponse,
  TraceConfig,
  SimulationTraces,
} from '../../sampling/types.js';
import { SAMPLING_CONFIG_VERSION } from '../../sampling/types.js';
import { MAX_NODES, MAX_EDGES } from '../../constants/limits.js';

/**
 * Configuration limits
 */
const LIMITS = {
  MAX_PERTURBATIONS: 100,
  MAX_NODES,
  MAX_EDGES,
  MAX_SAMPLES: 10000,
  DEFAULT_SAMPLES: 256,
};

/**
 * Request body for single simulation
 */
interface SingleSimulationRequest {
  graph: {
    nodes: Array<{ id: string; label?: string; value?: number; kind?: string }>;
    edges: Array<{
      from: string;
      to: string;
      weight?: number;
      belief?: number;
      belief_exists?: number;
      belief_strength?: number;
    }>;
  };
  seed?: number;
  n_samples?: number;
  return_traces?: boolean;
  mode?: 'interventional' | 'observational';
  interventions?: Array<{ node_id: string; value: number }>;
}

/**
 * Register batch simulation routes
 */
export async function registerSimulateBatchRoute(app: FastifyInstance) {
  /**
   * POST /v1/simulate - Single simulation with full trace output
   */
  app.post('/v1/simulate', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as SingleSimulationRequest;

    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'graph.nodes required',
        fields: { field: 'graph.nodes' },
      });
    }

    if (!body.graph.edges || !Array.isArray(body.graph.edges)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'graph.edges required',
        fields: { field: 'graph.edges' },
      });
    }

    if (body.graph.nodes.length > LIMITS.MAX_NODES) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `nodes exceed limit (${body.graph.nodes.length} > ${LIMITS.MAX_NODES})`,
        fields: { field: 'graph.nodes' },
      });
    }

    if (body.graph.edges.length > LIMITS.MAX_EDGES) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `edges exceed limit (${body.graph.edges.length} > ${LIMITS.MAX_EDGES})`,
        fields: { field: 'graph.edges' },
      });
    }

    const nSamples = Math.min(body.n_samples ?? LIMITS.DEFAULT_SAMPLES, LIMITS.MAX_SAMPLES);
    const seed = body.seed ?? 42;

    // Generate traces
    const config: TraceConfig = {
      seed,
      n_samples: nSamples,
      store_traces: body.return_traces ?? true,
      mode: body.mode,
      interventions: body.interventions,
    };

    let result: SimulationTraces;
    try {
      result = generateTraces(body.graph, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Simulation failed';
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message,
        fields: {},
      });
    }

    const duration = Date.now() - start;

    // Audit
    const responseHash = createHash('sha256')
      .update(JSON.stringify({ graph_hash: result.meta.graph_hash, seed }))
      .digest('hex')
      .slice(0, 16);

    recordAuditEvent({
      evt: 'simulate',
      route: '/v1/simulate',
      id: req.id,
      seed,
      inference_mode: body.mode ?? 'interventional',
      response_hash: responseHash,
      status: 200,
      ts: new Date().toISOString(),
    });

    req.log.info(
      {
        evt: 'simulate',
        id: req.id,
        route: '/v1/simulate',
        n_samples: nSamples,
        n_nodes: body.graph.nodes.length,
        n_edges: body.graph.edges.length,
        duration_ms: duration,
      },
      'simulation completed'
    );

    return reply.code(200).send({
      schema: 'simulate.v1',
      ...result,
      computation_time_ms: duration,
    });
  });

  /**
   * POST /v1/simulate/batch - Batch simulation with perturbations
   */
  app.post('/v1/simulate/batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as BatchSimulationRequest;

    // Validation: base_graph
    if (!body.base_graph || !body.base_graph.nodes || !Array.isArray(body.base_graph.nodes)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'base_graph.nodes required',
        fields: { field: 'base_graph.nodes' },
      });
    }

    if (!body.base_graph.edges || !Array.isArray(body.base_graph.edges)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'base_graph.edges required',
        fields: { field: 'base_graph.edges' },
      });
    }

    if (body.base_graph.nodes.length > LIMITS.MAX_NODES) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `base_graph.nodes exceed limit (${body.base_graph.nodes.length} > ${LIMITS.MAX_NODES})`,
        fields: { field: 'base_graph.nodes' },
      });
    }

    if (body.base_graph.edges.length > LIMITS.MAX_EDGES) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `base_graph.edges exceed limit (${body.base_graph.edges.length} > ${LIMITS.MAX_EDGES})`,
        fields: { field: 'base_graph.edges' },
      });
    }

    // Validation: perturbations
    if (!body.perturbations || !Array.isArray(body.perturbations)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'perturbations array required',
        fields: { field: 'perturbations' },
      });
    }

    if (body.perturbations.length > LIMITS.MAX_PERTURBATIONS) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `perturbations exceed limit (${body.perturbations.length} > ${LIMITS.MAX_PERTURBATIONS})`,
        fields: { field: 'perturbations' },
      });
    }

    // Check for duplicate perturbation IDs
    const perturbationIds = new Set<string>();
    for (const p of body.perturbations) {
      if (!p.perturbation_id) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'each perturbation must have a perturbation_id',
          fields: { field: 'perturbations[].perturbation_id' },
        });
      }
      if (perturbationIds.has(p.perturbation_id)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `duplicate perturbation_id: ${p.perturbation_id}`,
          fields: { field: 'perturbations' },
        });
      }
      perturbationIds.add(p.perturbation_id);
    }

    // Validation: options
    if (!body.options) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'options object required',
        fields: { field: 'options' },
      });
    }

    const nSamples = Math.min(body.options.n_samples ?? LIMITS.DEFAULT_SAMPLES, LIMITS.MAX_SAMPLES);

    // Ensure required options have defaults
    const normalizedRequest: BatchSimulationRequest = {
      ...body,
      base_seed: body.base_seed ?? 42,
      options: {
        n_samples: nSamples,
        return_traces: body.options.return_traces ?? false,
        cache_results: body.options.cache_results ?? true,
        mode: body.options.mode,
        interventions: body.options.interventions,
      },
    };

    // Run batch simulation
    let result: BatchSimulationResponse;
    try {
      result = runBatchSimulation(normalizedRequest);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Batch simulation failed';
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message,
        fields: {},
      });
    }

    const duration = Date.now() - start;

    // Audit
    const responseHash = createHash('sha256')
      .update(
        JSON.stringify({
          graph_hash: result.base_result.meta.graph_hash,
          seed: normalizedRequest.base_seed,
          perturbation_count: body.perturbations.length,
        })
      )
      .digest('hex')
      .slice(0, 16);

    recordAuditEvent({
      evt: 'simulate_batch',
      route: '/v1/simulate/batch',
      id: req.id,
      seed: normalizedRequest.base_seed,
      inference_mode: body.options.mode ?? 'interventional',
      response_hash: responseHash,
      status: 200,
      ts: new Date().toISOString(),
    });

    req.log.info(
      {
        evt: 'simulate_batch',
        id: req.id,
        route: '/v1/simulate/batch',
        n_samples: nSamples,
        n_perturbations: body.perturbations.length,
        cache_hits: result.cache_hits.length,
        duration_ms: duration,
      },
      'batch simulation completed'
    );

    return reply.code(200).send({
      schema: 'simulate_batch.v1',
      ...result,
    });
  });

  /**
   * GET /v1/simulate/cache/stats - Cache statistics
   */
  app.get('/v1/simulate/cache/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const cache = getTraceCache();
    const stats = cache.getStats();

    return reply.code(200).send({
      schema: 'cache_stats.v1',
      stats: {
        ...stats,
        sampling_config_version: SAMPLING_CONFIG_VERSION,
      },
    });
  });

  /**
   * POST /v1/simulate/cache/clear - Clear cache (admin only in production)
   */
  app.post('/v1/simulate/cache/clear', async (req: FastifyRequest, reply: FastifyReply) => {
    const cache = getTraceCache();
    const statsBefore = cache.getStats();

    cache.clear();

    req.log.info(
      {
        evt: 'cache_clear',
        id: req.id,
        route: '/v1/simulate/cache/clear',
        entries_cleared: statsBefore.size,
      },
      'trace cache cleared'
    );

    return reply.code(200).send({
      schema: 'cache_clear.v1',
      entries_cleared: statsBefore.size,
    });
  });

  /**
   * GET /v1/simulate/metrics - Sampling performance metrics
   */
  app.get('/v1/simulate/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    const metrics = getSamplingMetrics();
    const cache = getTraceCache();
    const cacheStats = cache.getStats();

    return reply.code(200).send({
      schema: 'sampling_metrics.v1',
      metrics: {
        ...metrics,
        cache: cacheStats,
        config: {
          sampling_config_version: SAMPLING_CONFIG_VERSION,
          trace_caching_enabled: cache.isEnabled(),
        },
      },
    });
  });
}
