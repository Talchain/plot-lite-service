/**
 * POST /v1/run_timeslices - Temporal causal runs
 * Evaluates the same graph across multiple timeslices with optional per-slice overrides
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';

interface SliceOverride {
  slice: string;
  nodes?: Array<{ id: string; [key: string]: any }>;
  edges?: Array<{ from: string; to: string; [key: string]: any }>;
}

interface RunTimeslicesRequest {
  graph: { nodes: any[]; edges: any[] };
  timeslices: string[];
  slice_overrides?: SliceOverride[];
  priors?: Record<string, number | { mean: number; sd: number }>;
  evidence?: Array<{ node_id: string; source: string; note?: string; weight?: number }>;
  seed?: number;
}

const MAX_NODES = 50;
const MAX_EDGES = 200;
const MAX_TIMESLICES = 12;

export async function registerRunTimeslicesRoute(app: FastifyInstance) {
  app.post('/v1/run_timeslices', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as RunTimeslicesRequest;
    
    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: 'graph.nodes required',
          field: 'graph.nodes'
        } 
      });
    }
    
    if (!body.timeslices || !Array.isArray(body.timeslices) || body.timeslices.length === 0) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: 'timeslices array required with at least one slice',
          field: 'timeslices'
        } 
      });
    }
    
    if (body.timeslices.length > MAX_TIMESLICES) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `Maximum ${MAX_TIMESLICES} timeslices allowed, got ${body.timeslices.length}`,
          field: 'timeslices'
        } 
      });
    }
    
    // Validate base graph limits
    if (body.graph.nodes.length > MAX_NODES) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `graph exceeds max ${MAX_NODES} nodes`,
          field: 'graph.nodes'
        } 
      });
    }
    
    const baseEdges = body.graph.edges || [];
    if (baseEdges.length > MAX_EDGES) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `graph exceeds max ${MAX_EDGES} edges`,
          field: 'graph.edges'
        } 
      });
    }
    
    // Validate slice_overrides reference valid slices
    const sliceSet = new Set(body.timeslices);
    const overrides = body.slice_overrides || [];
    for (const override of overrides) {
      if (!sliceSet.has(override.slice)) {
        return reply.code(400).send({ 
          error: { 
            type: 'BAD_INPUT', 
            message: `slice_override references unknown slice: ${override.slice}`,
            field: 'slice_overrides[].slice'
          } 
        });
      }
    }
    
    const seed = body.seed || 4242;
    
    // Validate priors if present
    if (body.priors) {
      const { validatePriors } = await import('../../lib/validate-priors.js');
      const nodeIds = new Set<string>(body.graph.nodes.map((n: any) => String(n.id)));
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
      const nodeIds = new Set<string>(body.graph.nodes.map((n: any) => String(n.id)));
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
    
    // Build override map
    const overrideMap = new Map<string, SliceOverride>();
    for (const override of overrides) {
      overrideMap.set(override.slice, override);
    }
    
    // Process each timeslice
    const results: Array<{
      slice: string;
      summary: { p10: number; p50: number; p90: number };
      confidence: number;
    }> = [];
    
    for (const slice of body.timeslices) {
      // Apply overrides if present
      let sliceGraph = { ...body.graph };
      const override = overrideMap.get(slice);
      if (override) {
        // Merge nodes
        const nodeMap = new Map(body.graph.nodes.map((n: any) => [n.id, { ...n }]));
        if (override.nodes) {
          for (const node of override.nodes) {
            nodeMap.set(node.id, { ...nodeMap.get(node.id), ...node });
          }
        }
        sliceGraph.nodes = Array.from(nodeMap.values());
        
        // Use override edges if provided, otherwise base edges
        if (override.edges !== undefined) {
          sliceGraph.edges = override.edges.map((e: any) => ({ ...e }));
        }
      }
      
      // Deterministic computation per slice (use slice name in seed derivation)
      const sliceHash = createHash('sha256').update(slice).digest('hex').slice(0, 8);
      const sliceSeed = seed + parseInt(sliceHash, 16) % 10000;
      
      // Placeholder: deterministic p50 based on slice seed
      const baseP50 = Math.round((sliceSeed / 10000 + 0.5) * 1000) / 1000;
      const p10 = Math.round(baseP50 * 0.8 * 1000) / 1000;
      const p50 = baseP50;
      const p90 = Math.round(baseP50 * 1.2 * 1000) / 1000;
      const confidence = 0.85;
      
      results.push({
        slice,
        summary: { p10, p50, p90 },
        confidence
      });
    }
    
    // Create response hash
    const responseHash = createHash('sha256')
      .update(JSON.stringify(results))
      .digest('hex')
      .slice(0, 16);
    
    const duration = Date.now() - start;
    req.log.info({ 
      evt: 'run_timeslices', 
      id: req.id, 
      route: '/v1/run_timeslices',
      nodes: body.graph.nodes.length,
      edges: baseEdges.length,
      timeslices: body.timeslices.length,
      overrides: overrides.length,
      priors_count: body.priors ? Object.keys(body.priors).length : 0,
      seed,
      duration_ms: duration
    });
    
    // Record audit event
    recordAuditEvent({
      evt: 'run_timeslices',
      route: '/v1/run_timeslices',
      id: req.id,
      seed,
      response_hash: responseHash,
      status: 200,
      ts: new Date().toISOString()
    });
    
    return reply.code(200).send({
      schema: 'run_timeslices.v1',
      results,
      model_card: {
        seed,
        response_hash: responseHash,
        timeslices_count: body.timeslices.length
      }
    });
  });
}
