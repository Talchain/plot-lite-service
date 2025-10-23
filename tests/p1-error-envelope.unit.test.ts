import { describe, it, expect } from 'vitest';
import {
  clampRetryAfter,
  rateLimitedError,
  limitExceededError,
  badInputError,
  errorCodeToStatus
} from '../src/errors.js';

describe('P1: error.v1 helpers', () => {
  it('clamps retry_after 1-60', () => {
    expect(clampRetryAfter(-5)).toBe(1);
    expect(clampRetryAfter(100)).toBe(60);
    expect(clampRetryAfter(15.7)).toBe(15);
  });

  it('rateLimitedError shape', () => {
    const err = rateLimitedError('Too many', 15);
    expect(err.schema).toBe('error.v1');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retry_after).toBe(15);
  });

  it('limitExceededError with fields', () => {
    const err = limitExceededError('graph.nodes', 12);
    expect(err.code).toBe('LIMIT_EXCEEDED');
    expect(err.fields).toEqual({ field: 'graph.nodes', max: 12 });
  });

  it('badInputError shape', () => {
    const err = badInputError('Invalid');
    expect(err.schema).toBe('error.v1');
    expect(err.code).toBe('BAD_INPUT');
  });

  it('status codes', () => {
    expect(errorCodeToStatus('BAD_INPUT')).toBe(400);
    expect(errorCodeToStatus('RATE_LIMITED')).toBe(429);
    expect(errorCodeToStatus('UNAUTHORIZED')).toBe(401);
    expect(errorCodeToStatus('SERVER_ERROR')).toBe(500);
  });
});
