import { describe, it, expect } from 'vitest';

describe('Confidence Comparison (Sprint N Feature 3)', () => {
  describe('compareConfidence', () => {
    it('detects same level with matching scores', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'MEDIUM' as const,
        score: 0.65,
        reason: 'Test reason',
        factors: { identifiability: 0.8, linearity_distance: 0.7, k_coverage: 0.6, calibration: 0.5 },
      };

      const calibrated = {
        level: 'MEDIUM' as const,
        score: 0.65,
        factors: { calibration: 0.6, identifiability: 0.7, linearity_distance: 0.1 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result.current.level).toBe('MEDIUM');
      expect(result.calibrated.level).toBe('MEDIUM');
      expect(result.delta).toBe(0);
      expect(result.level_changed).toBe(false);
      expect(result.level_direction).toBeUndefined();
      expect(result.interpretation).toContain('Both methods agree');
    });

    it('detects level upgrade', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'MEDIUM' as const,
        score: 0.55,
        reason: 'Test reason',
        factors: { identifiability: 0.6, linearity_distance: 0.5, k_coverage: 0.5, calibration: 0.5 },
      };

      const calibrated = {
        level: 'HIGH' as const,
        score: 0.85,
        factors: { calibration: 0.8, identifiability: 0.9, linearity_distance: 0.1 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result.current.level).toBe('MEDIUM');
      expect(result.calibrated.level).toBe('HIGH');
      expect(result.delta).toBe(0.3);
      expect(result.level_changed).toBe(true);
      expect(result.level_direction).toBe('upgrade');
      expect(result.interpretation).toContain('up from');
      expect(result.interpretation).toContain('+0.30');
    });

    it('detects level downgrade', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'HIGH' as const,
        score: 0.85,
        reason: 'Test reason',
        factors: { identifiability: 0.9, linearity_distance: 0.9, k_coverage: 0.8, calibration: 0.7 },
      };

      const calibrated = {
        level: 'MEDIUM' as const,
        score: 0.55,
        factors: { calibration: 0.5, identifiability: 0.6, linearity_distance: 0.3 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result.current.level).toBe('HIGH');
      expect(result.calibrated.level).toBe('MEDIUM');
      expect(result.delta).toBe(-0.3);
      expect(result.level_changed).toBe(true);
      expect(result.level_direction).toBe('downgrade');
      expect(result.interpretation).toContain('down from');
      expect(result.interpretation).toContain('-0.30');
    });

    it('detects same level with score difference', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'MEDIUM' as const,
        score: 0.50,
        reason: 'Test reason',
        factors: { identifiability: 0.5, linearity_distance: 0.5, k_coverage: 0.5, calibration: 0.5 },
      };

      const calibrated = {
        level: 'MEDIUM' as const,
        score: 0.70,
        factors: { calibration: 0.7, identifiability: 0.7, linearity_distance: 0.1 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result.level_changed).toBe(false);
      expect(result.delta).toBe(0.2);
      expect(result.interpretation).toContain('score differs by +0.20');
    });

    it('handles LOW to HIGH upgrade', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'LOW' as const,
        score: 0.30,
        reason: 'Test reason',
        factors: { identifiability: 0.3, linearity_distance: 0.3, k_coverage: 0.3, calibration: 0.3 },
      };

      const calibrated = {
        level: 'HIGH' as const,
        score: 0.90,
        factors: { calibration: 0.9, identifiability: 0.9, linearity_distance: 0.1 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result.level_direction).toBe('upgrade');
      expect(result.delta).toBe(0.6);
    });

    it('handles HIGH to LOW downgrade', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'HIGH' as const,
        score: 0.90,
        reason: 'Test reason',
        factors: { identifiability: 0.9, linearity_distance: 0.9, k_coverage: 0.9, calibration: 0.9 },
      };

      const calibrated = {
        level: 'LOW' as const,
        score: 0.20,
        factors: { calibration: 0.2, identifiability: 0.2, linearity_distance: 0.5 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result.level_direction).toBe('downgrade');
      expect(result.delta).toBe(-0.7);
    });

    it('rounds delta to 2 decimal places', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'MEDIUM' as const,
        score: 0.333,
        reason: 'Test reason',
        factors: { identifiability: 0.5, linearity_distance: 0.5, k_coverage: 0.5, calibration: 0.5 },
      };

      const calibrated = {
        level: 'MEDIUM' as const,
        score: 0.666,
        factors: { calibration: 0.7, identifiability: 0.6, linearity_distance: 0.1 },
      };

      const result = compareConfidence(current, calibrated);

      // Should round to 2 decimal places
      expect(result.delta).toBe(0.33);
    });

    it('returns correct structure', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'MEDIUM' as const,
        score: 0.6,
        reason: 'Test reason',
        factors: { identifiability: 0.6, linearity_distance: 0.6, k_coverage: 0.6, calibration: 0.6 },
      };

      const calibrated = {
        level: 'MEDIUM' as const,
        score: 0.65,
        factors: { calibration: 0.65, identifiability: 0.65, linearity_distance: 0.1 },
      };

      const result = compareConfidence(current, calibrated);

      expect(result).toHaveProperty('current');
      expect(result).toHaveProperty('calibrated');
      expect(result).toHaveProperty('delta');
      expect(result).toHaveProperty('level_changed');
      expect(result).toHaveProperty('interpretation');

      expect(result.current).toHaveProperty('level');
      expect(result.current).toHaveProperty('score');
      expect(result.calibrated).toHaveProperty('level');
      expect(result.calibrated).toHaveProperty('score');
    });

    it('is deterministic', async () => {
      const { compareConfidence } = await import('../src/trust/confidence-calibrated.js');

      const current = {
        level: 'MEDIUM' as const,
        score: 0.65,
        reason: 'Test reason',
        factors: { identifiability: 0.7, linearity_distance: 0.6, k_coverage: 0.6, calibration: 0.6 },
      };

      const calibrated = {
        level: 'HIGH' as const,
        score: 0.82,
        factors: { calibration: 0.8, identifiability: 0.85, linearity_distance: 0.1 },
      };

      const result1 = compareConfidence(current, calibrated);
      const result2 = compareConfidence(current, calibrated);

      expect(result1.delta).toBe(result2.delta);
      expect(result1.level_changed).toBe(result2.level_changed);
      expect(result1.level_direction).toBe(result2.level_direction);
      expect(result1.interpretation).toBe(result2.interpretation);
    });
  });
});
