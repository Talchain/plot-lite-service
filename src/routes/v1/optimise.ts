import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateConstraints, filterActionsByConstraints, isFeasible, type Constraints, type Action } from '../../engine/constraints.js';
import { runKernel } from '../../scm-lite/kernel.js';
import { adaptGraphToDAG } from '../../scm-lite/adapter.js';
import { canonicalIdempotencyPreHandler, canonicalIdempotencyOnSend } from '../../middleware/idempotency-canonical.js';
import { BODY_LIMIT_BYTES } from '../../config/constants.js';
import { replyWithAppError } from '../../errors.js';

interface OptimiseRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  budget: number;
  actions: Array<{ id: string; cost: number; do: Array<{ node_id: string; set_to: number }> }>;
  objective: { type: 'utility_linear'; weights: Record<string, number> };
  constraints?: Constraints;
  priors?: Record<string, number | { mean: number; sd: number }>;
  evidence?: Array<{ node_id: string; source: string; note?: string; weight?: number }>;
}

// Helper: Apply action interventions to graph by scaling edge weights
function applyAction(graph: any, action: any): any {
  const nodeMap = new Map(graph.nodes.map((n: any) => [n.id, { ...n }]));
  const interventionMap = new Map(action.do.map((d: any) => [d.node_id, d.set_to]));
  
  const modifiedEdges = graph.edges.map((e: any) => {
    const interventionValue = interventionMap.get(e.from);
    if (interventionValue !== undefined && typeof interventionValue === 'number') {
      return { ...e, weight: (e.weight || 1) * interventionValue };
    }
    return e;
  });
  
  return {
    nodes: Array.from(nodeMap.values()),
    edges: modifiedEdges
  };
}

// Helper: Evaluate multi-target utility by summing weighted p50 quantiles
async function evaluateUtility(graph: any, objective: any, seed: number): Promise<number> {
  let total = 0;
  for (const [target, weight] of Object.entries(objective?.weights || {})) {
    try {
      const dag = adaptGraphToDAG(graph);
      const res = await runKernel(dag, target, { seed });
      const p50 = res?.quantiles?.p50 ?? 0;
      total += p50 * (typeof weight === 'number' ? weight : 0);
    } catch (err) {
      // Kernel failure for one target is non-fatal; skip and continue with remaining targets
      console.warn('[optimise] evaluateUtility: kernel failed for target', target, err);
    }
  }
  return total;
}

// Honest method-disclosure markers (#240 scale_provenance tradition): the wire must
// not imply capabilities this route does not have.
// - greedy_independent_v1: a greedy-independent marginal-gain knapsack. Each action's
//   gain is measured independently vs the baseline, then actions are added greedily by
//   efficiency. It assumes ADDITIVE / INDEPENDENT action effects — it is NOT a joint
//   combinatorial optimiser, so synergies / diminishing-returns are ignored and the
//   greedy knapsack is not guaranteed optimal.
// - edge_weight_scaling: an action's do:[{node_id,set_to}] MULTIPLIES the weight of every
//   outgoing edge of node_id by set_to. It does NOT set the node's value (no Pearl
//   do-operator); a leaf/no-outgoing node is a silent no-op. Flagged for Neil doctrine.
const OPTIMISE_METHOD = 'greedy_independent_v1';
const OPTIMISE_ACTION_SEMANTICS = 'edge_weight_scaling';
// meta.solver names the SAME greedy-independent algorithm as OPTIMISE_METHOD above —
// two hand-maintained labels, separately test-pinned, that can drift. Any change to the
// optimiser algorithm MUST update BOTH this const and OPTIMISE_METHOD. (Unifying the two
// wire values is a separate rowed item; do NOT change either string here.)
const OPTIMISE_META_SOLVER = 'greedy_kernel_v1';

export async function registerOptimiseRoute(app: FastifyInstance) {
  app.post(
    '/v1/optimise',
    {
      preHandler: [
        async (req: FastifyRequest, reply: FastifyReply) => {
          await canonicalIdempotencyPreHandler(req, reply, '/v1/optimise');
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
    const body = req.body as OptimiseRequest;
    if (!body.actions || typeof body.budget !== 'number') {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'actions and budget required',
        fields: { field: 'body' }
      });
    }

    // R3: reject missing/invalid graph with a clean 400 (previously an unguarded
    // `body.graph.nodes.length` at the completion log threw an uncaught 500). Guard
    // here, before any downstream access to body.graph (priors/evidence/kernel).
    if (!body.graph || !Array.isArray(body.graph.nodes) || !Array.isArray(body.graph.edges)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'graph is required and must have nodes[] and edges[] arrays',
        fields: { field: 'graph' }
      });
    }

    const seed = body.seed || 4242;
    const actionIds = new Set<string>();
    for (const action of body.actions) {
      if (actionIds.has(action.id)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Duplicate action id: ${action.id}`,
          fields: { field: 'actions' }
        });
      }
      actionIds.add(action.id);
      if (action.cost < 0) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: 'Action costs must be >= 0',
          fields: { field: 'actions' }
        });
      }
    }
    
    // Validate priors if present
    if (body.priors) {
      const { validatePriors } = await import('../../lib/validate-priors.js');
      const nodeIds = new Set<string>(body.graph.nodes.map((n: any) => String(n.id)));
      const priorsValidation = validatePriors(body.priors, nodeIds);
      
      if (!priorsValidation.valid) {
        const firstError = priorsValidation.errors[0];
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: firstError.message,
          fields: { field: firstError.field }
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
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: firstError.message,
          fields: { field: firstError.field }
        });
      }
    }
    
    // Budget precedence: top-level budget always wins
    const userConstraints = body.constraints ?? {};
    const constraints: Constraints = { ...userConstraints, budget: body.budget };
    if (Object.prototype.hasOwnProperty.call(userConstraints, 'budget') &&
        (userConstraints as any).budget !== body.budget) {
      req.log.warn({
        evt: 'constraints_budget_override',
        requested: (userConstraints as any).budget,
        enforced: body.budget
      }, 'constraints.budget overridden by top-level budget');
    }
    
    // Check feasibility
    const { feasible, violations: feasibilityViolations } = isFeasible(body.actions as Action[], constraints);
    if (!feasible) {
      return reply.code(400).send({
        error: {
          schema: 'error.v1',
          code: 'INFEASIBLE',
          message: 'Constraints cannot be satisfied',
          violations: feasibilityViolations
        }
      });
    }
    
    // Filter actions by constraints
    const { filtered, violations: filterViolations } = filterActionsByConstraints(body.actions as Action[], constraints);
    if (filterViolations.length > 0) {
      return reply.code(400).send({
        error: {
          schema: 'error.v1',
          code: 'INFEASIBLE',
          message: 'Constraints cannot be satisfied',
          violations: filterViolations
        }
      });
    }
    
    // Start with must actions
    const mustActions = constraints.must 
      ? filtered.filter(a => constraints.must!.includes(a.id))
      : [];
    let spent = mustActions.reduce((sum, a) => sum + a.cost, 0);
    const selected: string[] = mustActions.map(a => a.id);
    
    // Deterministic solver: compute marginal gain for each action using kernel
    const remainingActions = filtered.filter(a => !selected.includes(a.id));
    
    // Validate objective weights
    if (!body.objective.weights || Object.keys(body.objective.weights).length === 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'objective.weights must specify at least one target node',
        fields: { field: 'objective.weights' }
      });
    }
    
    // Compute baseline utility (no actions) - sum across all targets
    let baselineUtility = 0;
    try {
      baselineUtility = await evaluateUtility(body.graph, body.objective, seed);
    } catch (err) {
      // If kernel fails, log but continue with zero baseline
      req.log.warn({ evt: 'optimise_baseline_failed', error: String(err) });
    }
    
    // Compute marginal gain for each remaining action
    const rankedActions = await Promise.all(remainingActions.map(async a => {
      let marginalGain = 0;
      try {
        const modifiedGraph = applyAction(body.graph, a);
        const actionUtility = await evaluateUtility(modifiedGraph, body.objective, seed);
        marginalGain = actionUtility - baselineUtility;
      } catch (err) {
        req.log.warn({ evt: 'optimise_action_eval_failed', action_id: a.id, error: String(err) });
      }
      
      return {
        ...a,
        marginalGain,
        efficiency: marginalGain / (a.cost || 1)
      };
    }));
    
    rankedActions.sort((a, b) => {
      // Deterministic tie-breaking by id
      if (Math.abs(b.efficiency - a.efficiency) < 0.0001) {
        return a.id.localeCompare(b.id);
      }
      return b.efficiency - a.efficiency;
    });
    
    // Add actions greedily
    for (const action of rankedActions) {
      if (spent + action.cost <= constraints.budget!) {
        selected.push(action.id);
        spent += action.cost;
      }
    }
    
    // Validate final selection against constraints
    const selectedActions = body.actions.filter(a => selected.includes(a.id)) as Action[];
    const finalViolations = validateConstraints(selectedActions, body.actions as Action[], constraints);
    if (finalViolations.length > 0) {
      return reply.code(400).send({
        error: {
          schema: 'error.v1',
          code: 'INFEASIBLE',
          message: 'Selected actions violate constraints',
          violations: finalViolations
        }
      });
    }
    
    // Compute final utility with selected actions
    let finalUtility = baselineUtility;
    const explanations: Array<{ action_id: string; marginal_gain: number }> = [];
    
    for (const actionId of selected) {
      const action = body.actions.find(a => a.id === actionId);
      if (action) {
        const rankedAction = rankedActions.find(ra => ra.id === actionId);
        const marginalGain = rankedAction?.marginalGain || 0;
        finalUtility += marginalGain;
        explanations.push({ action_id: actionId, marginal_gain: marginalGain });
      }
    }
    
    // Structured logging with constraints metadata
    const duration = Date.now() - start;
    const appliedKeys = Object.keys(userConstraints || {}).filter(k => k !== 'budget');
    const constraintsResolved = {
      budget: { value: body.budget, source: 'top_level' },
      ...Object.fromEntries(appliedKeys.map(k => [k, { source: 'user' }]))
    };
    
    req.log.info({
      evt: 'optimise_complete',
      id: req.id,
      route: '/v1/optimise',
      duration_ms: duration,
      nodes: body.graph.nodes.length,
      edges: body.graph.edges.length,
      actions_evaluated: body.actions.length,
      actions_selected: selected.length,
      budget_spent: spent,
      budget_total: body.budget,
      utility_baseline: baselineUtility,
      utility_final: finalUtility,
      seed,
      constraints_applied: appliedKeys,
      constraints_resolved: constraintsResolved
    });
    
    return reply.code(200).send({
      schema: 'optimise.v1',
      // Honest method disclosure (additive) — see const definitions above.
      method: OPTIMISE_METHOD,
      action_semantics: OPTIMISE_ACTION_SEMANTICS,
      selected,
      // R2 honesty: `expected` is a greedy-additive sum of per-action median deltas drawn
      // from distinct kernel runs over different graphs — no single MC distribution backs it,
      // so we do NOT fabricate p10/p50/p90 bands around it. Report only the computed point
      // estimate; absent beats synthetic (previously p10=expected*0.9, p50=expected, p90=expected*1.1).
      utility: { expected: finalUtility },
      explanations,
      meta: {
        seed,
        solver: OPTIMISE_META_SOLVER,
        constraints_applied: appliedKeys,
        constraints_resolved: constraintsResolved
      }
    });
  });
}
