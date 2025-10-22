/**
 * Error Helper Tests - Phase 3
 * Verifies rateLimitedError and limitExceededError helpers
 */
import { describe, it, expect } from 'vitest';
import { clampRetryAfter, rateLimitedError, limitExceededError } from '../dist/errors.js';

describe('Error Helpers', () => {
  describe('clampRetryAfter', () => {
    it('clamps to minimum 1 second', () => {
      expect(clampRetryAfter(0)).toBe(1);
      expect(clampRetryAfter(-5)).toBe(1);
      expect(clampRetryAfter(0.5)).toBe(1);
    });

    it('clamps to maximum 60 seconds', () => {
      expect(clampRetryAfter(100)).toBe(60);
      expect(clampRetryAfter(3600)).toBe(60);
      expect(clampRetryAfter(Infinity)).toBe(60);
    });

    it('preserves values in range', () => {
      expect(clampRetryAfter(1)).toBe(1);
      expect(clampRetryAfter(30)).toBe(30);
      expect(clampRetryAfter(60)).toBe(60);
    });

    it('floors decimal values', () => {
      expect(clampRetryAfter(5.7)).toBe(5);
      expect(clampRetryAfter(29.9)).toBe(29);
    });
  });

  describe('rateLimitedError', () => {
    it('returns RATE_LIMITED error with retry_after', () => {
      const err = rateLimitedError('Too many requests', 10);
      
      expect(err.error.type).toBe('RATE_LIMITED');
      expect(err.error.message).toBe('Too many requests');
      expect(err.error.retry_after).toBe(10);
      expect(err.error.hint).toBe('Please retry after 10 seconds');
    });

    it('defaults to 10 seconds if not specified', () => {
      const err = rateLimitedError('System under load');
      
      expect(err.error.retry_after).toBe(10);
      expect(err.error.hint).toBe('Please retry after 10 seconds');
    });

    it('clamps retry_after to 1-60 range', () => {
      const err1 = rateLimitedError('Test', 0);
      expect(err1.error.retry_after).toBe(1);
      
      const err2 = rateLimitedError('Test', 100);
      expect(err2.error.retry_after).toBe(60);
    });

    it('includes friendly hint with exact seconds', () => {
      const err = rateLimitedError('Test', 5);
      expect(err.error.hint).toContain('5 seconds');
      expect(err.error.hint).toContain('Please retry');
    });
  });

  describe('limitExceededError', () => {
    it('returns LIMIT_EXCEEDED error with field and max', () => {
      const err = limitExceededError('nodes', 12, 'Too many nodes');
      
      expect(err.error.type).toBe('LIMIT_EXCEEDED');
      expect(err.error.message).toBe('Too many nodes');
      expect(err.error.fields).toEqual({ field: 'nodes', max: 12 });
    });

    it('generates default message if not provided', () => {
      const err = limitExceededError('edges', 20);
      
      expect(err.error.message).toBe('Limit exceeded for edges');
      expect(err.error.fields).toEqual({ field: 'edges', max: 20 });
    });

    it('includes field and max in fields object', () => {
      const err = limitExceededError('connections', 50, 'Custom message');
      
      expect(err.error.fields?.field).toBe('connections');
      expect(err.error.fields?.max).toBe(50);
    });
  });

  describe('Error JSON shapes', () => {
    it('RATE_LIMITED has consistent shape', () => {
      const err = rateLimitedError('Test', 5);
      
      // Must have these exact fields
      expect(err).toHaveProperty('error');
      expect(err.error).toHaveProperty('type');
      expect(err.error).toHaveProperty('message');
      expect(err.error).toHaveProperty('hint');
      expect(err.error).toHaveProperty('retry_after');
      
      // Type check
      expect(typeof err.error.type).toBe('string');
      expect(typeof err.error.message).toBe('string');
      expect(typeof err.error.hint).toBe('string');
      expect(typeof err.error.retry_after).toBe('number');
    });

    it('LIMIT_EXCEEDED has consistent shape', () => {
      const err = limitExceededError('test_field', 100);
      
      // Must have these exact fields
      expect(err).toHaveProperty('error');
      expect(err.error).toHaveProperty('type');
      expect(err.error).toHaveProperty('message');
      expect(err.error).toHaveProperty('fields');
      
      // Fields structure
      expect(err.error.fields).toHaveProperty('field');
      expect(err.error.fields).toHaveProperty('max');
      
      // Type check
      expect(typeof err.error.type).toBe('string');
      expect(typeof err.error.message).toBe('string');
      expect(typeof err.error.fields?.field).toBe('string');
      expect(typeof err.error.fields?.max).toBe('number');
    });
  });

  describe('Friendly copy consistency', () => {
    it('RATE_LIMITED copy contains "Please retry"', () => {
      const err = rateLimitedError('Test', 10);
      expect(err.error.hint?.toLowerCase()).toContain('please retry');
    });

    it('RATE_LIMITED copy includes specific seconds', () => {
      const err1 = rateLimitedError('Test', 5);
      expect(err1.error.hint).toContain('5 seconds');
      
      const err2 = rateLimitedError('Test', 30);
      expect(err2.error.hint).toContain('30 seconds');
    });

    it('LIMIT_EXCEEDED copy mentions the field', () => {
      const err = limitExceededError('nodes', 12);
      expect(err.error.message.toLowerCase()).toContain('nodes');
    });
  });
});
