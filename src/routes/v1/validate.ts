import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { normalizeGraph } from '../../util/normalize.js';
import { validationSeverityToLevel } from '../../trust/severity-bridge.js';
import { computeGraphViolations } from '../../lib/graph-violations.js';

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
    
    // Structural graph violations (shared with run_bundle review pass)
    if (body.graph?.nodes && body.graph?.edges) {
      const graphViolations = computeGraphViolations(body.graph.nodes, body.graph.edges);
      for (const gv of graphViolations) {
        violations.push({
          code: gv.code,
          severity: gv.severity,
          level: validationSeverityToLevel(gv.severity),
          at: gv.at,
          suggestion: gv.suggestion,
        });
      }
    }
    
    // valid is false only if at least one violation has severity: 'error' (or missing severity)
    const hasError = violations.some(v => (v.severity ?? 'error') !== 'warning');
    return reply.send({ valid: !hasError, violations, normalized: body.graph });
  });
}
