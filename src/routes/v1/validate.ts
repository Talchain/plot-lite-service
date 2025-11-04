import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { normalizeGraph } from '../../util/normalize.js';

export async function registerValidateRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  
  app.post('/v1/validate', {
    schema: { body: { type: 'object', required: ['graph'], properties: { graph: { type: 'object' } } } },
    attachValidation: true,
    preHandler: [createValidator('run')],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req as any).body || {};
    if (body.graph) {
      body.graph = normalizeGraph(body.graph, false);
    }
    
    const violations: any[] = [];
    if ((req as any).validationError) {
      const err = (req as any).validationError;
      violations.push({ path: 'body', reason: err.message || 'validation_failed' });
    }
    
    // Check outcome edges for missing belief (non-fatal warning)
    if (body.graph?.nodes && body.graph?.edges) {
      const outcomes = new Set(body.graph.nodes.filter((n: any) => n.kind === 'outcome').map((n: any) => n.id));
      const nodeIds = new Set(body.graph.nodes.map((n: any) => n.id));
      
      body.graph.edges.forEach((e: any) => {
        // Missing belief on outcome edge
        if (outcomes.has(e.to) && e.belief === undefined) {
          violations.push({
            code: 'MISSING_BELIEF_ON_OUTCOME_EDGE',
            severity: 'warning',
            at: { from: e.from, to: e.to },
            suggestion: 'Add belief 0..1 to edges into outcomes to calibrate uncertainty.'
          });
        }
        
        // Weight magnitude too large
        if (typeof e.weight === 'number' && Math.abs(e.weight) > 3) {
          violations.push({
            code: 'WEIGHT_MAGNITUDE_HIGH',
            severity: 'warning',
            at: { from: e.from, to: e.to },
            suggestion: 'Consider rescaling weight to |weight| ≤ 3 for numerical stability.'
          });
        }
      });
      
      // Check for disconnected decision→outcome paths
      const decisions = body.graph.nodes.filter((n: any) => n.kind === 'decision').map((n: any) => n.id);
      const outgoingEdges = new Map<string, boolean>();
      body.graph.edges.forEach((e: any) => {
        outgoingEdges.set(e.from, true);
      });
      
      decisions.forEach((decisionId: string) => {
        if (!outgoingEdges.has(decisionId)) {
          violations.push({
            code: 'DECISION_NO_OUTGOING',
            severity: 'warning',
            at: { node: decisionId },
            suggestion: 'Connect decision node to options or outcomes.'
          });
        }
      });
      
      // Check for options without outgoing edges
      const options = body.graph.nodes.filter((n: any) => n.kind === 'option').map((n: any) => n.id);
      options.forEach((optionId: string) => {
        if (!outgoingEdges.has(optionId)) {
          violations.push({
            code: 'OPTION_NO_OUTGOING',
            severity: 'warning',
            at: { node: optionId },
            suggestion: 'Connect option node to outcomes to model consequences.'
          });
        }
      });
    }
    
    return reply.send({ valid: violations.length === 0, violations });
  });
}
