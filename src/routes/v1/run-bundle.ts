/**
 * POST /v1/run_bundle - Scenario bundle processing
 * Takes a base graph + labeled deltas for efficient multi-scenario evaluation
 * Uses real SCM-Lite inference for each scenario (not stubs)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { replyWithAppError } from '../../errors.js';
import { canonicalIdempotencyPreHandler, canonicalIdempotencyOnSend } from '../../middleware/idempotency-canonical.js';
import { BODY_LIMIT_BYTES } from '../../config/constants.js';
import { getInferenceEngine } from '../../inference/index.js';
import { normalizeGraph } from '../../util/normalize.js';
import type { DetailLevel } from '../../trust/types.js';
import { DETAIL_LEVEL_CONFIG } from '../../trust/types.js';

interface GraphDelta {
  label: string;
  nodes?: Array<{ id: string; value?: number; [key: string]: any }>;
  edges?: Array<{ from: string; to: string; [key: string]: any }>;
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
}

const MAX_NODES = 50;
const MAX_EDGES = 200;
const MAX_DELTAS = 10;

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

    // Pre-validate all graphs and build scenario list
    const scenarios: Array<{
      index: number;
      label: string;
      graph: { nodes: any[]; edges: any[] };
      scenarioSeed: number;
    }> = [];

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
      const graph = normalizeGraph(rawGraph, false);

      // Deterministic seed per scenario: base seed + index + 1
      const scenarioSeed = seed + i + 1;

      scenarios.push({
        index: i,
        label: delta.label,
        graph,
        scenarioSeed,
      });
    }

    // Determine outcome node (defaults to last node in first scenario)
    const outcome_node = body.outcome_node ??
      scenarios[0]?.graph.nodes[scenarios[0].graph.nodes.length - 1]?.id;

    // Get inference engine
    const inferenceEngine = getInferenceEngine('model_based');

    // Run inference on all scenarios in parallel
    const inferenceResults = await Promise.all(
      scenarios.map(async (scenario) => {
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
          req.log.warn({
            evt: 'run_bundle_inference_error',
            label: scenario.label,
            index: scenario.index,
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            success: false as const,
            scenario,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
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
      }

      return result;
    });
    
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

    const response: any = {
      schema: 'run_bundle.v1',
      results,
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
