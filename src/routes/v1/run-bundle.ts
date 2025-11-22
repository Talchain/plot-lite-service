/**
 * POST /v1/run_bundle - Scenario bundle processing
 * Takes a base graph + labeled deltas for efficient multi-scenario evaluation
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';

interface GraphDelta {
  label: string;
  nodes?: Array<{ id: string; value?: number; [key: string]: any }>;
  edges?: Array<{ from: string; to: string; [key: string]: any }>;
}

interface RunBundleRequest {
  base_graph: { nodes: any[]; edges: any[] };
  deltas: GraphDelta[];
  seed?: number;
  priors?: Record<string, number | { mean: number; sd: number }>;
  evidence?: Array<{ node_id: string; source: string; note?: string; weight?: number }>;
}

const MAX_NODES = 50;
const MAX_EDGES = 200;
const MAX_DELTAS = 10;

export async function registerRunBundleRoute(app: FastifyInstance) {
  app.post('/v1/run_bundle', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as RunBundleRequest;
    
    // Validation
    if (!body.base_graph || !body.base_graph.nodes || !Array.isArray(body.base_graph.nodes)) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: 'base_graph.nodes required',
          field: 'base_graph.nodes'
        } 
      });
    }
    
    if (!body.deltas || !Array.isArray(body.deltas) || body.deltas.length === 0) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: 'deltas array required with at least one scenario',
          field: 'deltas'
        } 
      });
    }
    
    if (body.deltas.length > MAX_DELTAS) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `Maximum ${MAX_DELTAS} deltas allowed, got ${body.deltas.length}`,
          field: 'deltas'
        } 
      });
    }
    
    // Validate base graph limits
    if (body.base_graph.nodes.length > MAX_NODES) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `base_graph exceeds max ${MAX_NODES} nodes`,
          field: 'base_graph.nodes'
        } 
      });
    }
    
    // Validate base_graph.edges is array if present
    if (body.base_graph.edges !== undefined && !Array.isArray(body.base_graph.edges)) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: 'base_graph.edges must be an array',
          field: 'base_graph.edges'
        } 
      });
    }
    
    // Validate priors if present
    if (body.priors) {
      const { validatePriors } = await import('../../lib/validate-priors.js');
      const nodeIds = new Set<string>(body.base_graph.nodes.map((n: any) => String(n.id)));
      const priorsValidation = validatePriors(body.priors, nodeIds);
      
      if (!priorsValidation.valid) {
        const firstError = priorsValidation.errors[0];
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
      const nodeIds = new Set<string>(body.base_graph.nodes.map((n: any) => String(n.id)));
      const evidenceValidation = validateEvidence(body.evidence, nodeIds);
      
      if (!evidenceValidation.valid) {
        const firstError = evidenceValidation.errors[0];
        return reply.code(400).send({
          error: {
            type: 'BAD_INPUT',
            message: firstError.message,
            field: firstError.field
          }
        });
      }
    }
    
    const baseEdges = body.base_graph.edges || [];
    if (baseEdges.length > MAX_EDGES) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `base_graph exceeds max ${MAX_EDGES} edges`,
          field: 'base_graph.edges'
        } 
      });
    }
    
    const seed = body.seed || 4242;
    const results: any[] = [];
    const seenHashes = new Set<string>();
    
    // Process each delta
    for (let i = 0; i < body.deltas.length; i++) {
      const delta = body.deltas[i];
      
      // Apply delta to base graph
      const graph = applyDelta(body.base_graph, delta);
      
      // Validate merged graph limits
      if (graph.nodes.length > MAX_NODES) {
        return reply.code(400).send({ 
          error: { 
            type: 'BAD_INPUT', 
            message: `Delta '${delta.label}' results in ${graph.nodes.length} nodes (max ${MAX_NODES})`,
            field: `deltas[${i}]`
          } 
        });
      }
      
      if (graph.edges.length > MAX_EDGES) {
        return reply.code(400).send({ 
          error: { 
            type: 'BAD_INPUT', 
            message: `Delta '${delta.label}' results in ${graph.edges.length} edges (max ${MAX_EDGES})`,
            field: `deltas[${i}]`
          } 
        });
      }
      
      // Compute result (stub) - deterministic based on graph content
      const graphHash = createHash('sha256')
        .update(JSON.stringify({ nodes: graph.nodes, edges: graph.edges, seed }))
        .digest('hex');
      const hashValue = parseInt(graphHash.slice(0, 8), 16) / 0xffffffff;
      const p50 = Math.round((hashValue * 0.3 + 0.5) * 1000) / 1000;
      const p10 = Math.round(p50 * 0.8 * 1000) / 1000;
      const p90 = Math.round(p50 * 1.2 * 1000) / 1000;
      
      const result: any = {
        label: delta.label,
        summary: { p10, p50, p90 },
        model_card: {
          schema: 'report.v1',
          seed,
          nodes: graph.nodes.length,
          edges: graph.edges.length
        }
      };
      
      // Create response hash for deduplication
      const responseHash = createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex')
        .slice(0, 16);
      
      result.model_card.response_hash = responseHash;
      
      // Track for dedup reporting
      if (seenHashes.has(responseHash)) {
        result.model_card.duplicate = true;
      } else {
        seenHashes.add(responseHash);
      }
      
      results.push(result);
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
    
    const response: any = {
      schema: 'run_bundle.v1',
      results,
      model_card: {
        seed,
        response_hash: bundleHash
      },
      meta: {
        seed,
        total_scenarios: body.deltas.length,
        unique_results: seenHashes.size
      }
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
