/**
 * A2: Error Taxonomy Tests
 * Validates closed-set error codes and helpful fields
 */
import { describe, it, expect } from 'vitest';
import { 
  clampRetryAfter, 
  limitExceededError, 
  rateLimitedError,
  errorTypeToStatus 
} from '../src/errors.js';

describe('A2: Error Taxonomy', () => {
  describe('clampRetryAfter', () => {
    it('clamps to minimum 1 second', () => {
      expect(clampRetryAfter(0)).toBe(1);
      expect(clampRetryAfter(-5)).toBe(1);
      expect(clampRetryAfter(0.5)).toBe(1);
    });

    it('clamps to maximum 60 seconds', () => {
      expect(clampRetryAfter(61)).toBe(60);
      expect(clampRetryAfter(120)).toBe(60);
      expect(clampRetryAfter(999)).toBe(60);
    });

    it('preserves valid range', () => {
      expect(clampRetryAfter(1)).toBe(1);
      expect(clampRetryAfter(30)).toBe(30);
      expect(clampRetryAfter(60)).toBe(60);
    });

    it('floors decimal values', () => {
      expect(clampRetryAfter(5.7)).toBe(5);
      expect(clampRetryAfter(30.9)).toBe(30);
    });
  });

  describe('limitExceededError', () => {
    it('returns correct shape for nodes', () => {
      const err = limitExceededError('graph.nodes', 12);
      expect(err).toEqual({
        schema: 'error.v1',
        code: 'LIMIT_EXCEEDED',
        field: 'graph.nodes',
        max: 12,
        error: 'Limit exceeded for graph.nodes: maximum is 12'
      });
    });

    it('returns correct shape for edges', () => {
      const err = limitExceededError('graph.edges', 20);
      expect(err).toEqual({
        schema: 'error.v1',
        code: 'LIMIT_EXCEEDED',
        field: 'graph.edges',
        max: 20,
        error: 'Limit exceeded for graph.edges: maximum is 20'
      });
    });

    it('includes all required fields', () => {
      const err = limitExceededError('test.field', 100);
      expect(err).toHaveProperty('schema', 'error.v1');
      expect(err).toHaveProperty('code', 'LIMIT_EXCEEDED');
      expect(err).toHaveProperty('field');
      expect(err).toHaveProperty('max');
      expect(err).toHaveProperty('error');
    });
  });

  describe('rateLimitedError', () => {
    it('returns correct shape with clamped retry_after', () => {
      const err = rateLimitedError(10);
      expect(err).toEqual({
        schema: 'error.v1',
        code: 'RATE_LIMITED',
        error: 'Too many requests',
        retry_after: 10
      });
    });

    it('clamps high retry values', () => {
      const err = rateLimitedError(120);
      expect(err.retry_after).toBe(60);
    });

    it('clamps low retry values', () => {
      const err = rateLimitedError(0);
      expect(err.retry_after).toBe(1);
    });

    it('includes all required fields', () => {
      const err = rateLimitedError(5);
      expect(err).toHaveProperty('schema', 'error.v1');
      expect(err).toHaveProperty('code', 'RATE_LIMITED');
      expect(err).toHaveProperty('error');
      expect(err).toHaveProperty('retry_after');
    });

    it('retry_after is always an integer', () => {
      const err = rateLimitedError(5.7);
      expect(Number.isInteger(err.retry_after)).toBe(true);
    });
  });

  describe('errorTypeToStatus', () => {
    it('maps BAD_INPUT to 400', () => {
      expect(errorTypeToStatus('BAD_INPUT')).toBe(400);
    });

    it('maps LIMIT_EXCEEDED to 400', () => {
      expect(errorTypeToStatus('LIMIT_EXCEEDED')).toBe(400);
    });

    it('maps RATE_LIMITED to 429', () => {
      expect(errorTypeToStatus('RATE_LIMITED')).toBe(429);
    });

    it('maps UNAUTHORIZED to 401', () => {
      expect(errorTypeToStatus('UNAUTHORIZED')).toBe(401);
    });

    it('maps SERVER_ERROR to 500', () => {
      expect(errorTypeToStatus('SERVER_ERROR')).toBe(500);
    });
  });

  describe('Error shape examples', () => {
    it('BAD_INPUT example', () => {
      const err = {
        schema: 'error.v1',
        code: 'BAD_INPUT',
        field: 'graph.goalNodeId',
        error: 'Missing required field: goalNodeId',
        hint: 'Set a goal node'
      };
      
      expect(err.schema).toBe('error.v1');
      expect(err.code).toBe('BAD_INPUT');
      expect(err).toHaveProperty('field');
      expect(err).toHaveProperty('hint');
    });

    it('LIMIT_EXCEEDED example', () => {
      const err = limitExceededError('graph.nodes', 12);
      
      expect(err.schema).toBe('error.v1');
      expect(err.code).toBe('LIMIT_EXCEEDED');
      expect(err.field).toBe('graph.nodes');
      expect(err.max).toBe(12);
    });

    it('RATE_LIMITED example', () => {
      const err = rateLimitedError(5);
      
      expect(err.schema).toBe('error.v1');
      expect(err.code).toBe('RATE_LIMITED');
      expect(err.retry_after).toBe(5);
      expect(err.retry_after).toBeGreaterThanOrEqual(1);
      expect(err.retry_after).toBeLessThanOrEqual(60);
    });
  });
});
