import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import {
  streamQuerySchema,
  streamInitEventSchema,
  streamTokenEventSchema,
  streamHeartbeatEventSchema,
  streamDoneEventSchema,
  streamErrorEventSchema
} from '../src/schemas/stream.js';

const ajv = new Ajv();

describe('P1: Stream Request Schema', () => {
  const validate = ajv.compile(streamQuerySchema);

  it('accepts valid query parameters', () => {
    expect(validate({ demo: 1, latency_ms: 100 })).toBe(true);
    expect(validate({ heartbeat_ms: 30000 })).toBe(true);
    expect(validate({ max_events: 100 })).toBe(true);
    expect(validate({})).toBe(true); // All optional
  });

  it('rejects invalid demo values', () => {
    expect(validate({ demo: 2 })).toBe(false);
    expect(validate({ demo: -1 })).toBe(false);
  });

  it('rejects out-of-range latency_ms', () => {
    expect(validate({ latency_ms: -1 })).toBe(false);
    expect(validate({ latency_ms: 70000 })).toBe(false);
  });

  it('rejects out-of-range heartbeat_ms', () => {
    expect(validate({ heartbeat_ms: -1 })).toBe(false);
    expect(validate({ heartbeat_ms: 70000 })).toBe(false);
  });

  it('rejects out-of-range max_events', () => {
    expect(validate({ max_events: 0 })).toBe(false);
    expect(validate({ max_events: 20000 })).toBe(false);
  });

  it('rejects additional properties', () => {
    expect(validate({ demo: 1, unknown: 'field' })).toBe(false);
  });
});

describe('P1: Stream Event Schemas', () => {
  it('validates stream.init.v1', () => {
    const validate = ajv.compile(streamInitEventSchema);
    
    expect(validate({
      schema: 'stream.init.v1',
      ts: '2025-01-01T00:00:00.000Z',
      heartbeat_ms: 30000
    })).toBe(true);
    
    expect(validate({
      schema: 'stream.init.v1',
      ts: '2025-01-01T00:00:00.000Z',
      trace_id: 'abc-123',
      heartbeat_ms: 0
    })).toBe(true);
    
    // Missing required field
    expect(validate({
      schema: 'stream.init.v1',
      ts: '2025-01-01T00:00:00.000Z'
    })).toBe(false);
  });

  it('validates stream.token.v1', () => {
    const validate = ajv.compile(streamTokenEventSchema);
    
    expect(validate({
      schema: 'stream.token.v1',
      text: 'hello',
      index: 0
    })).toBe(true);
    
    // Missing required field
    expect(validate({
      schema: 'stream.token.v1',
      text: 'hello'
    })).toBe(false);
  });

  it('validates stream.heartbeat.v1', () => {
    const validate = ajv.compile(streamHeartbeatEventSchema);
    
    expect(validate({
      schema: 'stream.heartbeat.v1',
      ts: '2025-01-01T00:00:00.000Z',
      seq: 1
    })).toBe(true);
    
    expect(validate({
      schema: 'stream.heartbeat.v1',
      ts: '2025-01-01T00:00:00.000Z',
      seq: 0
    })).toBe(true);
  });

  it('validates stream.done.v1', () => {
    const validate = ajv.compile(streamDoneEventSchema);
    
    expect(validate({
      schema: 'stream.done.v1',
      reason: 'complete'
    })).toBe(true);
    
    expect(validate({
      schema: 'stream.done.v1',
      reason: 'circuit_open'
    })).toBe(true);
    
    // Invalid reason
    expect(validate({
      schema: 'stream.done.v1',
      reason: 'unknown'
    })).toBe(false);
  });

  it('validates stream.error.v1', () => {
    const validate = ajv.compile(streamErrorEventSchema);
    
    expect(validate({
      schema: 'stream.error.v1',
      code: 'CIRCUIT_OPEN',
      message: 'Service unavailable',
      recoverable: true
    })).toBe(true);
    
    // Missing required field
    expect(validate({
      schema: 'stream.error.v1',
      code: 'ERROR',
      message: 'Failed'
    })).toBe(false);
  });
});
