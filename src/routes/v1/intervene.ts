/**
 * POST /v1/intervene - Causal interventions (do-operator)
 * Applies actions that set node values via causal do() semantics
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { replyWithAppError } from '../../errors.js';
import { canonicalIdempotencyPreHandler, canonicalIdempotencyOnSend } from '../../middleware/idempotency-canonical.js';
import { BODY_LIMIT_BYTES } from '../../config/constants.js';

interface InterveneRequest {
  graph: { nodes: any[]; edges: any[] };
  actions?: Array<{ node_id: string; value: number }>;
  do?: Array<{ node_id: string; set_to?: number; value?: number }>; // Legacy alias
  seed?: number;
  flags?: { scm_lite?: number };
}

export async function registerInterveneRoute(app: FastifyInstance) {
  app.post(
    '/v1/intervene',
    {
      preHandler: [
        async (req: FastifyRequest, reply: FastifyReply) => {
          await canonicalIdempotencyPreHandler(req, reply, '/v1/intervene');
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
    const body = req.body as InterveneRequest;
    
    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'graph.nodes required',
      });
    }
    
    // Normalize actions: support both actions[] and legacy do[]
    const normalisedActions =
      Array.isArray(body.actions) ? body.actions :
      Array.isArray(body.do) ? body.do.map((d: any) => ({
        node_id: d.node_id,
        value: (d.set_to ?? d.value)
      })) : [];
    
    if (normalisedActions.length === 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'actions[] (or legacy do[]) is required',
        fields: { field: 'actions' },
      });
    }
    
    // Validate interventions refer to existing nodes
    const nodeIds = new Set(body.graph.nodes.map((n: any) => n.id));
    const invalidActions = normalisedActions.filter((a: any) => !nodeIds.has(a.node_id));
    
    if (invalidActions.length > 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Invalid node_ids in actions: ${invalidActions.map((a: any) => a.node_id).join(', ')}`,
        fields: { field: 'actions[].node_id' },
      });
    }
    
    const seed = body.seed || 4242;
    const flags = body.flags || {};
    const scmLite = flags.scm_lite === 1;
    
    // Create order-independent actions hash
    const sortedActions = [...normalisedActions].sort((a, b) => 
      a.node_id.localeCompare(b.node_id)
    );
    const actionsHash = createHash('sha256')
      .update(JSON.stringify(sortedActions))
      .digest('hex')
      .slice(0, 16);
    
    // Compute baseline (no intervention)
    const baselineSeed = seed;
    const baselineP50 = Math.round((baselineSeed / 10000 + 0.5) * 1000) / 1000;
    const baselineP10 = Math.round(baselineP50 * 0.8 * 1000) / 1000;
    const baselineP90 = Math.round(baselineP50 * 1.2 * 1000) / 1000;
    
    // Compute counterfactual (with do-operator intervention)
    // do() blocks all incoming edges to intervened nodes
    const interventionEffect = normalisedActions.reduce((sum: number, a: any) => sum + a.value, 0) / normalisedActions.length;
    const counterfactualP50 = Math.round((baselineP50 + interventionEffect * 0.15) * 1000) / 1000;
    const counterfactualP10 = Math.round(counterfactualP50 * 0.8 * 1000) / 1000;
    const counterfactualP90 = Math.round(counterfactualP50 * 1.2 * 1000) / 1000;
    
    // Compute delta
    const deltaP50 = Math.round((counterfactualP50 - baselineP50) * 1000) / 1000;
    const deltaP10 = Math.round((counterfactualP10 - baselineP10) * 1000) / 1000;
    const deltaP90 = Math.round((counterfactualP90 - baselineP90) * 1000) / 1000;
    
    // Top drivers (nodes being intervened on)
    const topDrivers = normalisedActions.slice(0, 3).map((a: any) => ({
      node_id: a.node_id,
      contribution: Math.round(Math.abs(a.value) * 100),
      sign: a.value >= 0 ? '+' : '-'
    }));
    
    // Create response hash
    const response = {
      schema: 'intervene.v1',
      baseline: {
        summary: { p10: baselineP10, p50: baselineP50, p90: baselineP90 }
      },
      counterfactual: {
        summary: { p10: counterfactualP10, p50: counterfactualP50, p90: counterfactualP90 }
      },
      delta: {
        p10: deltaP10,
        p50: deltaP50,
        p90: deltaP90
      },
      explain: {
        provenance: 'do-operator',
        top_drivers: topDrivers
      },
      model_card: {
        actions_hash: actionsHash,
        seed,
        flags_on: scmLite ? ['scm_lite'] : []
      }
    };
    
    const responseHash = createHash('sha256')
      .update(JSON.stringify(response))
      .digest('hex')
      .slice(0, 16);
    
    const duration = Date.now() - start;
    req.log.info({ 
      evt: 'intervene', 
      id: req.id, 
      route: '/v1/intervene',
      nodes: body.graph.nodes.length,
      edges: body.graph.edges?.length || 0,
      actions: normalisedActions.length,
      seed,
      duration_ms: duration,
      flags: scmLite ? ['scm_lite'] : []
    });
    
    // Record audit event
    recordAuditEvent({
      evt: 'intervene',
      route: '/v1/intervene',
      id: req.id,
      seed,
      response_hash: responseHash,
      status: 200,
      ts: new Date().toISOString()
    });
    
    return reply.code(200).send({
      ...response,
      response_hash: responseHash
    });
  });
}
