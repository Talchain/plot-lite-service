/**
 * AJV schemas for /v1/stream endpoint
 */

export const streamQuerySchema = {
  type: 'object',
  properties: {
    demo: { type: 'integer', enum: [0, 1] },
    latency_ms: { type: 'integer', minimum: 0, maximum: 60000 },
    heartbeat_ms: { type: 'integer', minimum: 0, maximum: 60000 },
    max_events: { type: 'integer', minimum: 1, maximum: 10000 }
  },
  additionalProperties: false
} as const;

// SSE Event Schemas (versioned)

export const streamInitEventSchema = {
  type: 'object',
  required: ['schema', 'ts', 'heartbeat_ms'],
  properties: {
    schema: { const: 'stream.init.v1' },
    ts: { type: 'string' },
    trace_id: { type: 'string' },
    heartbeat_ms: { type: 'integer', minimum: 0 }
  },
  additionalProperties: false
} as const;

export const streamTokenEventSchema = {
  type: 'object',
  required: ['schema', 'text', 'index'],
  properties: {
    schema: { const: 'stream.token.v1' },
    text: { type: 'string' },
    index: { type: 'integer', minimum: 0 }
  },
  additionalProperties: false
} as const;

export const streamHeartbeatEventSchema = {
  type: 'object',
  required: ['schema', 'ts', 'seq'],
  properties: {
    schema: { const: 'stream.heartbeat.v1' },
    ts: { type: 'string' },
    seq: { type: 'integer', minimum: 0 }
  },
  additionalProperties: false
} as const;

export const streamDoneEventSchema = {
  type: 'object',
  required: ['schema', 'reason'],
  properties: {
    schema: { const: 'stream.done.v1' },
    reason: { 
      type: 'string',
      enum: ['complete', 'timeout', 'client_cancel', 'circuit_open', 'error']
    }
  },
  additionalProperties: false
} as const;

export const streamErrorEventSchema = {
  type: 'object',
  required: ['schema', 'code', 'message', 'recoverable'],
  properties: {
    schema: { const: 'stream.error.v1' },
    code: { type: 'string' },
    message: { type: 'string' },
    recoverable: { type: 'boolean' }
  },
  additionalProperties: false
} as const;
