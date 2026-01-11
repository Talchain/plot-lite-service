/**
 * POST /v1/intervene - Causal interventions (do-operator)
 * Applies actions that set node values via causal do() semantics
 *
 * Uses Pearl's do-calculus: when we intervene on X (do(X=x)):
 * 1. Cut all incoming edges to X
 * 2. Set X to a fixed value x
 * 3. Propagate effects downstream naturally
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { replyWithAppError } from '../../errors.js';
import { canonicalIdempotencyPreHandler, canonicalIdempotencyOnSend } from '../../middleware/idempotency-canonical.js';
import { BODY_LIMIT_BYTES } from '../../config/constants.js';
import { runKernel } from '../../scm-lite/kernel.js';
import { adaptGraphToDAG } from '../../scm-lite/adapter.js';
import type { Intervention } from '../../scm-lite/types.js';

interface InterveneRequest {
  graph: { nodes: any[]; edges: any[] };
  actions?: Array<{ node_id: string; value: number }>;
  do?: Array<{ node_id: string; set_to?: number; value?: number }>; // Legacy alias
  target?: string; // Explicit target node (optional - auto-detected if not provided)
  seed?: number;
  k_samples?: number; // Number of Monte Carlo samples (default 256)
  flags?: { scm_lite?: number };
}

/**
 * Find the target node for intervention analysis.
 * Priority:
 * 1. Explicit target parameter
 * 2. Node with kind='goal'
 * 3. Node with kind='outcome'
 * 4. Leaf node (no outgoing edges)
 * 5. Last node in the list
 */
function findTargetNode(graph: { nodes: any[]; edges: any[] }, explicitTarget?: string): string | null {
  // 1. Explicit target
  if (explicitTarget) {
    const node = graph.nodes.find((n: any) => n.id === explicitTarget);
    if (node) return explicitTarget;
  }

  // 2. Node with kind='goal'
  const goalNode = graph.nodes.find((n: any) => n.kind === 'goal');
  if (goalNode) return goalNode.id;

  // 3. Node with kind='outcome'
  const outcomeNode = graph.nodes.find((n: any) => n.kind === 'outcome');
  if (outcomeNode) return outcomeNode.id;

  // 4. Leaf node (no outgoing edges)
  const nodesWithOutgoing = new Set((graph.edges || []).map((e: any) => e.from));
  const leafNode = graph.nodes.find((n: any) => !nodesWithOutgoing.has(n.id));
  if (leafNode) return leafNode.id;

  // 5. Last node
  if (graph.nodes.length > 0) {
    return graph.nodes[graph.nodes.length - 1].id;
  }

  return null;
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
    const normalisedActions: Array<{ node_id: string; value: number }> =
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

    // Validate action values are numbers
    const invalidValues = normalisedActions.filter((a: any) => typeof a.value !== 'number' || !Number.isFinite(a.value));
    if (invalidValues.length > 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Invalid values in actions: ${invalidValues.map((a: any) => `${a.node_id}=${a.value}`).join(', ')}`,
        fields: { field: 'actions[].value' },
      });
    }

    // Find target node
    const target = findTargetNode(body.graph, body.target);
    if (!target) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'Unable to determine target node. Provide target parameter or ensure graph has a goal/outcome node.',
        fields: { field: 'target' },
      });
    }

    // Validate target exists
    if (!nodeIds.has(target)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Target node '${target}' not found in graph`,
        fields: { field: 'target' },
      });
    }

    const seed = body.seed ?? 4242;
    const K = body.k_samples ?? 256;
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

    // Convert actions to kernel intervention format
    const interventions: Intervention[] = normalisedActions.map(a => ({
      node_id: a.node_id,
      value: a.value,
    }));

    // Adapt graph to DAG format for kernel
    const dag = adaptGraphToDAG(body.graph as any);

    // Run kernel to compute baseline (observational - no interventions)
    const baselineResult = runKernel(dag, target, {
      seed,
      K,
      mode: 'observational',
    });

    // Run kernel to compute counterfactual (interventional - with do-operator)
    const counterfactualResult = runKernel(dag, target, {
      seed,
      K,
      interventions,
      mode: 'interventional',
    });

    // Extract quantiles
    const baselineP10 = baselineResult.quantiles.p10;
    const baselineP50 = baselineResult.quantiles.p50;
    const baselineP90 = baselineResult.quantiles.p90;

    const counterfactualP10 = counterfactualResult.quantiles.p10;
    const counterfactualP50 = counterfactualResult.quantiles.p50;
    const counterfactualP90 = counterfactualResult.quantiles.p90;

    // Compute delta (effect of intervention)
    const deltaP10 = Math.round((counterfactualP10 - baselineP10) * 1000) / 1000;
    const deltaP50 = Math.round((counterfactualP50 - baselineP50) * 1000) / 1000;
    const deltaP90 = Math.round((counterfactualP90 - baselineP90) * 1000) / 1000;

    // Top drivers (nodes being intervened on, sorted by absolute contribution)
    const topDrivers = normalisedActions
      .map((a: any) => ({
        node_id: a.node_id,
        contribution: Math.round(Math.abs(a.value) * 100),
        sign: a.value >= 0 ? '+' : '-'
      }))
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3);

    // Create response
    const response = {
      schema: 'intervene.v1',
      target,
      baseline: {
        summary: { p10: baselineP10, p50: baselineP50, p90: baselineP90 },
        confidence: baselineResult.confidence,
      },
      counterfactual: {
        summary: { p10: counterfactualP10, p50: counterfactualP50, p90: counterfactualP90 },
        confidence: counterfactualResult.confidence,
      },
      delta: {
        p10: deltaP10,
        p50: deltaP50,
        p90: deltaP90
      },
      explain: {
        provenance: 'do-operator',
        top_drivers: topDrivers,
        inference_mode: 'interventional',
      },
      model_card: {
        actions_hash: actionsHash,
        seed,
        k_samples: K,
        k_evaluated: counterfactualResult.meta.K_evaluated,
        flags_on: scmLite ? ['scm_lite'] : [],
        bma_hash: counterfactualResult.bma_hash,
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
      target,
      nodes: body.graph.nodes.length,
      edges: body.graph.edges?.length || 0,
      actions: normalisedActions.length,
      seed,
      k_samples: K,
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
