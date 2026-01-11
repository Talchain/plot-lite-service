import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { normalizeGraph } from '../../util/normalize.js';
import { validationSeverityToLevel } from '../../trust/severity-bridge.js';

type Violation = {
  code?: string;
  severity?: 'error' | 'warning';
  level?: 'ERROR' | 'WARNING' | 'INFO';
  path?: string;
  reason?: string;
  at?: any;
  suggestion?: string;
};

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
    
    const violations: Violation[] = [];
    if ((req as any).validationError) {
      const err = (req as any).validationError;
      const severity: 'error' | 'warning' = 'error';
      violations.push({
        code: 'SCHEMA_VALIDATION_FAILED',
        severity,
        level: validationSeverityToLevel(severity),
        path: 'body',
        reason: err.message || 'validation_failed'
      });
    }
    
    // Teaching validator: 4 non-fatal warnings with suggestions
    if (body.graph?.nodes && body.graph?.edges) {
      const outcomes = new Set(body.graph.nodes.filter((n: any) => n.kind === 'outcome').map((n: any) => n.id));
      const decisions = new Set(body.graph.nodes.filter((n: any) => n.kind === 'decision').map((n: any) => n.id));
      const options = new Set(body.graph.nodes.filter((n: any) => n.kind === 'option').map((n: any) => n.id));
      
      // 1. MISSING_BELIEF_ON_OUTCOME_EDGE
      body.graph.edges.forEach((e: any) => {
        if (outcomes.has(e.to) && e.belief === undefined) {
          const severity: 'error' | 'warning' = 'warning';
          violations.push({ 
            code: 'MISSING_BELIEF_ON_OUTCOME_EDGE', 
            severity,
            level: validationSeverityToLevel(severity),
            at: { from: e.from, to: e.to },
            suggestion: 'Add belief 0..1 to edges into outcomes to calibrate uncertainty.'
          });
        }
      });
      
      // 2. WEIGHT_MAGNITUDE_HIGH
      body.graph.edges.forEach((e: any) => {
        if (e.weight !== undefined && Math.abs(e.weight) > 3) {
          const severity: 'error' | 'warning' = 'warning';
          violations.push({ 
            code: 'WEIGHT_MAGNITUDE_HIGH', 
            severity,
            level: validationSeverityToLevel(severity),
            at: { from: e.from, to: e.to, weight: e.weight },
            suggestion: 'Consider rescaling weights to [-3, +3] for numerical stability.'
          });
        }
      });
      
      // 3. DECISION_NO_OUTGOING
      for (const decisionId of decisions) {
        const hasOutgoing = body.graph.edges.some((e: any) => e.from === decisionId);
        if (!hasOutgoing) {
          const severity: 'error' | 'warning' = 'warning';
          violations.push({ 
            code: 'DECISION_NO_OUTGOING', 
            severity,
            level: validationSeverityToLevel(severity),
            at: { node: decisionId },
            suggestion: 'Decision nodes should have outgoing edges to options or outcomes.'
          });
        }
      }
      
      // 4. OPTION_NO_OUTGOING
      for (const optionId of options) {
        const hasOutgoing = body.graph.edges.some((e: any) => e.from === optionId);
        if (!hasOutgoing) {
          const severity: 'error' | 'warning' = 'warning';
          violations.push({
            code: 'OPTION_NO_OUTGOING',
            severity,
            level: validationSeverityToLevel(severity),
            at: { node: optionId },
            suggestion: 'Option nodes should have outgoing edges to outcomes.'
          });
        }
      }

      // 5. FACTOR_HAS_INCOMING_EDGES
      const factors = body.graph.nodes.filter((n: any) => n.kind === 'factor');
      for (const factor of factors) {
        const incomingEdges = body.graph.edges.filter((e: any) => e.to === factor.id);
        if (incomingEdges.length > 0) {
          const severity: 'error' | 'warning' = 'warning';
          violations.push({
            code: 'FACTOR_HAS_INCOMING_EDGES',
            severity,
            level: validationSeverityToLevel(severity),
            at: { node_id: factor.id, label: factor.label },
            suggestion: 'Remove incoming edges or change node type to outcome/risk. Factors represent external inputs and should be root nodes.'
          });
        }
      }
    }
    
    // valid is false only if at least one violation has severity: 'error' (or missing severity)
    const hasError = violations.some(v => (v.severity ?? 'error') !== 'warning');
    return reply.send({ valid: !hasError, violations });
  });
}
