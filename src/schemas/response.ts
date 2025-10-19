export const runResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['schema', 'confidence', 'results', 'model_card', 'meta'],
  properties: {
    schema: { type: 'string', const: 'run.v1' },
    confidence: { type: 'object', required: ['level', 'reason', 'score'] },
    results: { type: 'object', required: ['conservative', 'most_likely', 'optimistic'] },
    model_card: { type: 'object', required: ['response_hash'] },
    meta: { type: 'object', required: ['seed', 'version'] },
    graph: { type: 'object', nullable: true },
    critique: { type: 'object', nullable: true },
    explain_delta: { type: 'object', nullable: true },
    identifiability: { type: 'object', nullable: true },
    trace_id: { type: 'string', nullable: true }
  }
} as const;

export const healthResponseSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['status', 'api_version', 'version', 'uptime_s']
} as const;
