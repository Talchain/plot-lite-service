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
    debug: { type: 'object', additionalProperties: true, nullable: true }
  }
} as const;

export const healthResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['status', 'api_version', 'version', 'uptime_s']
} as const;
