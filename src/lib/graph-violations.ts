/**
 * Structural graph validation — shared logic used by /validate route and review pass.
 *
 * Produces the same violation codes as /v1/validate:
 *   MISSING_BELIEF_ON_OUTCOME_EDGE (warning)
 *   WEIGHT_MAGNITUDE_HIGH          (warning)
 *   DECISION_NO_OUTGOING           (warning)
 *   OPTION_NO_OUTGOING             (warning)
 *   FACTOR_HAS_INCOMING_EDGES      (warning)
 */

export interface GraphViolation {
  code: string;
  severity: 'error' | 'warning';
  at?: {
    node?: string;
    node_id?: string;
    label?: string;
    from?: string;
    to?: string;
    weight?: number;
  };
  suggestion?: string;
}

/**
 * Compute structural violations for a normalized graph.
 *
 * Does NOT include schema validation (SCHEMA_VALIDATION_FAILED) — that
 * requires the Fastify validator and is only produced at the route level.
 */
export function computeGraphViolations(
  nodes: Array<{ id: string; kind?: string; label?: string; [key: string]: unknown }>,
  edges: Array<{ from: string; to: string; weight?: number; belief?: number; [key: string]: unknown }>,
): GraphViolation[] {
  const violations: GraphViolation[] = [];

  const outcomes = new Set(
    nodes.filter((n) => n.kind === 'outcome').map((n) => n.id),
  );
  const decisions = new Set(
    nodes.filter((n) => n.kind === 'decision').map((n) => n.id),
  );
  const options = new Set(
    nodes.filter((n) => n.kind === 'option').map((n) => n.id),
  );

  // 1. MISSING_BELIEF_ON_OUTCOME_EDGE
  for (const e of edges) {
    if (outcomes.has(e.to) && e.belief === undefined) {
      violations.push({
        code: 'MISSING_BELIEF_ON_OUTCOME_EDGE',
        severity: 'warning',
        at: { from: e.from, to: e.to },
        suggestion: 'Add belief 0..1 to edges into outcomes to calibrate uncertainty.',
      });
    }
  }

  // 2. WEIGHT_MAGNITUDE_HIGH
  for (const e of edges) {
    if (e.weight !== undefined && Math.abs(e.weight) > 3) {
      violations.push({
        code: 'WEIGHT_MAGNITUDE_HIGH',
        severity: 'warning',
        at: { from: e.from, to: e.to, weight: e.weight },
        suggestion: 'Consider rescaling weights to [-3, +3] for numerical stability.',
      });
    }
  }

  // 3. DECISION_NO_OUTGOING
  for (const decisionId of decisions) {
    const hasOutgoing = edges.some((e) => e.from === decisionId);
    if (!hasOutgoing) {
      violations.push({
        code: 'DECISION_NO_OUTGOING',
        severity: 'warning',
        at: { node: decisionId },
        suggestion: 'Decision nodes should have outgoing edges to options or outcomes.',
      });
    }
  }

  // 4. OPTION_NO_OUTGOING
  for (const optionId of options) {
    const hasOutgoing = edges.some((e) => e.from === optionId);
    if (!hasOutgoing) {
      violations.push({
        code: 'OPTION_NO_OUTGOING',
        severity: 'warning',
        at: { node: optionId },
        suggestion: 'Option nodes should have outgoing edges to outcomes.',
      });
    }
  }

  // 5. FACTOR_HAS_INCOMING_EDGES
  const factors = nodes.filter((n) => n.kind === 'factor');
  for (const factor of factors) {
    const hasIncoming = edges.some((e) => e.to === factor.id);
    if (hasIncoming) {
      violations.push({
        code: 'FACTOR_HAS_INCOMING_EDGES',
        severity: 'warning',
        at: { node_id: factor.id, label: factor.label },
        suggestion: 'Remove incoming edges or change node type to outcome/risk. Factors represent external inputs and should be root nodes.',
      });
    }
  }

  return violations;
}
