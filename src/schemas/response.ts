export const runResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['schema', 'confidence', 'results', 'model_card', 'meta'],
  properties: {
    schema: { type: 'string', enum: ['run.v1', 'report.v1'] },
    confidence: { type: 'object', additionalProperties: true, required: ['level', 'reason', 'score'] },
    results: { type: 'object', additionalProperties: true, required: ['conservative', 'most_likely', 'optimistic'] },
    model_card: { type: 'object', additionalProperties: true, required: ['seed', 'determinism_note', 'response_hash'] },
    meta: { type: 'object', additionalProperties: true, required: ['seed', 'version'] },
    graph: { type: 'object', additionalProperties: true, nullable: true },
    critique: { type: 'array', items: { type: 'object', additionalProperties: true }, nullable: true },
    explain_delta: { type: 'object', additionalProperties: true, nullable: true },
    identifiability: { type: 'string', nullable: true },
    trace_id: { type: 'string', nullable: true },
    debug: { type: 'object', additionalProperties: true, nullable: true },
    // Sprint N fields (detail_level gated)
    sensitivity_summary: { type: 'object', additionalProperties: true, nullable: true },
    graph_quality: { type: 'object', additionalProperties: true, nullable: true },
    insights: { type: 'object', additionalProperties: true, nullable: true },
    // Sprint N: Evidence-Aware Critique (standard/deep detail_level)
    evidence_analysis: {
      type: 'object',
      nullable: true,
      properties: {
        evidence_backed_edges: { type: 'array', items: { type: 'string' } },
        assumption_edges: { type: 'array', items: { type: 'string' } },
        coverage_pct: { type: 'number' },
        critical_gaps: { type: 'array', items: { type: 'object', additionalProperties: true } }
      }
    },
    // Sprint N: Full Sensitivity (deep detail_level only)
    sensitivity_full: {
      type: 'object',
      nullable: true,
      properties: {
        edges: { type: 'array', items: { type: 'object', additionalProperties: true } },
        hhi: { type: 'number' },
        concentration: { type: 'string', enum: ['high', 'medium', 'diffuse'] },
        edges_to_80pct: { type: 'number' },
        total_score: { type: 'number' },
        interpretation: { type: 'string' }
      }
    },
    // Sprint N: Confidence Comparison (deep detail_level only, experimental)
    confidence_comparison: {
      type: 'object',
      nullable: true,
      properties: {
        current: { type: 'object', properties: { level: { type: 'string' }, score: { type: 'number' } } },
        calibrated: { type: 'object', properties: { level: { type: 'string' }, score: { type: 'number' } } },
        delta: { type: 'number' },
        level_changed: { type: 'boolean' },
        level_direction: { type: 'string', enum: ['upgrade', 'downgrade', 'same'], nullable: true },
        interpretation: { type: 'string' }
      }
    },
    // Brief A: Per-option goal probabilities (ENABLE_OPTION_PROBABILITIES flag)
    option_probabilities: {
      type: 'object',
      nullable: true,
      additionalProperties: {
        type: 'object',
        properties: {
          goal_probability: { type: 'number', description: 'P(goal achieved | do(option))' },
          confidence: { type: 'number', description: 'Confidence in estimate (0-1)' }
        },
        required: ['goal_probability', 'confidence']
      }
    }
  }
} as const;

export const healthResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['status', 'api_version', 'version', 'uptime_s']
} as const;
