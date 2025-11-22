import { describe, it, expect } from 'vitest';
import { applyEffect, validateEffect } from '../src/engine/effects.js';

describe('Node Effects', () => {
  describe('applyEffect', () => {
    it('linear (default) returns identity', () => {
      expect(applyEffect(0.5)).toBe(0.5);
      expect(applyEffect(0.8, { kind: 'linear' })).toBe(0.8);
    });

    it('threshold applies step function', () => {
      const effect = {
        kind: 'threshold' as const,
        params: { threshold: 0.6, low: 0.0, high: 1.0 }
      };
      
      expect(applyEffect(0.3, effect)).toBe(0.0);
      expect(applyEffect(0.6, effect)).toBe(1.0);
      expect(applyEffect(0.9, effect)).toBe(1.0);
    });

    it('piecewise_linear interpolates', () => {
      const effect = {
        kind: 'piecewise_linear' as const,
        params: {
          breakpoints: [
            { x: 0.0, y: 0.0 },
            { x: 0.5, y: 0.8 },
            { x: 1.0, y: 1.0 }
          ]
        }
      };
      
      expect(applyEffect(0.0, effect)).toBe(0.0);
      expect(applyEffect(0.25, effect)).toBeCloseTo(0.4, 2);
      expect(applyEffect(0.5, effect)).toBe(0.8);
      expect(applyEffect(0.75, effect)).toBeCloseTo(0.9, 2);
      expect(applyEffect(1.0, effect)).toBe(1.0);
    });

    it('piecewise_linear clamps outside range', () => {
      const effect = {
        kind: 'piecewise_linear' as const,
        params: {
          breakpoints: [
            { x: 0.2, y: 0.1 },
            { x: 0.8, y: 0.9 }
          ]
        }
      };
      
      expect(applyEffect(0.0, effect)).toBe(0.1); // Clamp to first
      expect(applyEffect(1.0, effect)).toBe(0.9); // Clamp to last
    });
  });

  describe('validateEffect', () => {
    it('accepts undefined/null', () => {
      expect(validateEffect(undefined).valid).toBe(true);
      expect(validateEffect(null).valid).toBe(true);
    });

    it('accepts linear', () => {
      expect(validateEffect({ kind: 'linear' }).valid).toBe(true);
    });

    it('validates threshold params', () => {
      expect(validateEffect({
        kind: 'threshold',
        params: { threshold: 0.5, low: 0.0, high: 1.0 }
      }).valid).toBe(true);
      
      expect(validateEffect({
        kind: 'threshold'
      }).valid).toBe(false);
      
      expect(validateEffect({
        kind: 'threshold',
        params: { threshold: 'invalid', low: 0, high: 1 }
      }).valid).toBe(false);
      
      expect(validateEffect({
        kind: 'threshold',
        params: { threshold: Infinity, low: 0, high: 1 }
      }).valid).toBe(false);
    });

    it('validates piecewise_linear params', () => {
      expect(validateEffect({
        kind: 'piecewise_linear',
        params: {
          breakpoints: [
            { x: 0, y: 0 },
            { x: 1, y: 1 }
          ]
        }
      }).valid).toBe(true);
      
      expect(validateEffect({
        kind: 'piecewise_linear'
      }).valid).toBe(false);
      
      expect(validateEffect({
        kind: 'piecewise_linear',
        params: { breakpoints: [{ x: 0, y: 0 }] } // Only 1 point
      }).valid).toBe(false);
      
      expect(validateEffect({
        kind: 'piecewise_linear',
        params: {
          breakpoints: [
            { x: 0, y: 0 },
            { x: 'invalid', y: 1 }
          ]
        }
      }).valid).toBe(false);
    });

    it('rejects unknown effect kind', () => {
      const result = validateEffect({ kind: 'unknown' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown');
    });
  });
});
