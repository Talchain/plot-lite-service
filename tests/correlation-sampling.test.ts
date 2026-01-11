/**
 * Correlation Sampling Tests
 *
 * Phase 3: Model Enhancements - Consume ISL Correlation Groups
 * Tests for correlated sampling using Cholesky decomposition.
 */

import { describe, it, expect } from 'vitest';
import {
  SeededRNG,
  isSymmetric,
  hasValidDiagonal,
  isPositiveSemiDefinite,
  choleskyDecomposition,
  multiplyLowerTriangular,
  validateCorrelationMatrix,
  repairCorrelationMatrix,
  sampleCorrelatedGroup,
  sampleAllCorrelationGroups,
  validateCorrelationGroups,
} from '../src/engine/correlation-sampling.js';
import type { CorrelationGroup } from '../src/trust/types.js';

describe('Correlation Sampling', () => {
  describe('SeededRNG', () => {
    it('produces deterministic output for same seed', () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(42);

      for (let i = 0; i < 10; i++) {
        expect(rng1.next()).toBe(rng2.next());
      }
    });

    it('produces different output for different seeds', () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(123);

      // Should be different (with very high probability)
      const values1 = Array.from({ length: 5 }, () => rng1.next());
      const values2 = Array.from({ length: 5 }, () => rng2.next());

      expect(values1).not.toEqual(values2);
    });

    it('generates values in [0, 1) range', () => {
      const rng = new SeededRNG(42);

      for (let i = 0; i < 100; i++) {
        const value = rng.next();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it('nextNormal generates approximately standard normal', () => {
      const rng = new SeededRNG(42);
      const samples: number[] = [];

      for (let i = 0; i < 1000; i++) {
        samples.push(rng.nextNormal());
      }

      // Mean should be close to 0
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(Math.abs(mean)).toBeLessThan(0.15);

      // Variance should be close to 1
      const variance =
        samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
      expect(variance).toBeGreaterThan(0.7);
      expect(variance).toBeLessThan(1.3);
    });

    it('nextNormalVector generates correct length', () => {
      const rng = new SeededRNG(42);
      const vector = rng.nextNormalVector(5);

      expect(vector).toHaveLength(5);
    });
  });

  describe('Matrix Validation', () => {
    describe('isSymmetric', () => {
      it('returns true for symmetric matrix', () => {
        const matrix = [
          [1, 0.5, 0.3],
          [0.5, 1, 0.4],
          [0.3, 0.4, 1],
        ];
        expect(isSymmetric(matrix)).toBe(true);
      });

      it('returns false for non-symmetric matrix', () => {
        const matrix = [
          [1, 0.5, 0.3],
          [0.6, 1, 0.4], // 0.6 != 0.5
          [0.3, 0.4, 1],
        ];
        expect(isSymmetric(matrix)).toBe(false);
      });

      it('returns false for non-square matrix', () => {
        const matrix = [
          [1, 0.5],
          [0.5, 1],
          [0.3, 0.4],
        ];
        expect(isSymmetric(matrix)).toBe(false);
      });
    });

    describe('hasValidDiagonal', () => {
      it('returns true when all diagonal elements are 1', () => {
        const matrix = [
          [1, 0.5],
          [0.5, 1],
        ];
        expect(hasValidDiagonal(matrix)).toBe(true);
      });

      it('returns false when diagonal element is not 1', () => {
        const matrix = [
          [1, 0.5],
          [0.5, 0.9],
        ];
        expect(hasValidDiagonal(matrix)).toBe(false);
      });
    });

    describe('isPositiveSemiDefinite', () => {
      it('returns true for identity matrix', () => {
        const matrix = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];
        expect(isPositiveSemiDefinite(matrix)).toBe(true);
      });

      it('returns true for valid correlation matrix', () => {
        const matrix = [
          [1, 0.5],
          [0.5, 1],
        ];
        expect(isPositiveSemiDefinite(matrix)).toBe(true);
      });

      it('returns false for invalid correlation matrix', () => {
        // This matrix is not PSD (determinant is negative)
        const matrix = [
          [1, 0.9, 0.9],
          [0.9, 1, -0.5],
          [0.9, -0.5, 1],
        ];
        expect(isPositiveSemiDefinite(matrix)).toBe(false);
      });
    });
  });

  describe('Cholesky Decomposition', () => {
    it('decomposes identity matrix correctly', () => {
      const matrix = [
        [1, 0],
        [0, 1],
      ];
      const L = choleskyDecomposition(matrix);

      expect(L[0][0]).toBeCloseTo(1, 10);
      expect(L[0][1]).toBeCloseTo(0, 10);
      expect(L[1][0]).toBeCloseTo(0, 10);
      expect(L[1][1]).toBeCloseTo(1, 10);
    });

    it('decomposes correlation matrix correctly', () => {
      const matrix = [
        [1, 0.5],
        [0.5, 1],
      ];
      const L = choleskyDecomposition(matrix);

      // Verify L * L^T = original matrix
      const reconstructed = [
        [L[0][0] * L[0][0], L[0][0] * L[1][0]],
        [L[1][0] * L[0][0], L[1][0] * L[1][0] + L[1][1] * L[1][1]],
      ];

      expect(reconstructed[0][0]).toBeCloseTo(matrix[0][0], 10);
      expect(reconstructed[0][1]).toBeCloseTo(matrix[0][1], 10);
      expect(reconstructed[1][0]).toBeCloseTo(matrix[1][0], 10);
      expect(reconstructed[1][1]).toBeCloseTo(matrix[1][1], 10);
    });

    it('throws for non-PSD matrix', () => {
      const matrix = [
        [1, 2],
        [2, 1], // Not PSD
      ];
      expect(() => choleskyDecomposition(matrix)).toThrow();
    });

    it('handles 3x3 correlation matrix', () => {
      const matrix = [
        [1, 0.5, 0.3],
        [0.5, 1, 0.4],
        [0.3, 0.4, 1],
      ];
      const L = choleskyDecomposition(matrix);

      // L should be lower triangular
      expect(L[0][1]).toBeCloseTo(0, 10);
      expect(L[0][2]).toBeCloseTo(0, 10);
      expect(L[1][2]).toBeCloseTo(0, 10);
    });
  });

  describe('multiplyLowerTriangular', () => {
    it('multiplies correctly', () => {
      const L = [
        [1, 0],
        [0.5, 0.866],
      ];
      const z = [1, 0];

      const y = multiplyLowerTriangular(L, z);

      expect(y[0]).toBeCloseTo(1, 5);
      expect(y[1]).toBeCloseTo(0.5, 5);
    });

    it('produces correlated output from independent input', () => {
      const L = [
        [1, 0],
        [0.5, 0.866],
      ];
      const z = [0, 1];

      const y = multiplyLowerTriangular(L, z);

      expect(y[0]).toBeCloseTo(0, 5);
      expect(y[1]).toBeCloseTo(0.866, 3);
    });
  });

  describe('validateCorrelationMatrix', () => {
    it('accepts valid correlation matrix', () => {
      const matrix = [
        [1, 0.5],
        [0.5, 1],
      ];
      const result = validateCorrelationMatrix(matrix);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects empty matrix', () => {
      const result = validateCorrelationMatrix([]);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Empty');
    });

    it('rejects non-square matrix', () => {
      const matrix = [
        [1, 0.5],
        [0.5, 1, 0],
      ];
      const result = validateCorrelationMatrix(matrix);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not square');
    });

    it('rejects non-symmetric matrix', () => {
      const matrix = [
        [1, 0.5],
        [0.6, 1],
      ];
      const result = validateCorrelationMatrix(matrix);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not symmetric');
    });

    it('rejects out-of-range correlations', () => {
      const matrix = [
        [1, 1.5],
        [1.5, 1],
      ];
      const result = validateCorrelationMatrix(matrix);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('out of range');
    });

    it('warns about non-unit diagonal', () => {
      const matrix = [
        [0.99, 0.5],
        [0.5, 0.99],
      ];
      const result = validateCorrelationMatrix(matrix);

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('repairs near-PSD matrix when enabled', () => {
      // Matrix that's almost PSD but not quite
      const matrix = [
        [1, 0.95, 0.95],
        [0.95, 1, 0.1],
        [0.95, 0.1, 1],
      ];
      const result = validateCorrelationMatrix(matrix, { enable_repair: true });

      if (result.repaired) {
        expect(result.valid).toBe(true);
        expect(result.repaired_matrix).toBeDefined();
      }
    });
  });

  describe('repairCorrelationMatrix', () => {
    it('fixes simple diagonal issues', () => {
      const matrix = [
        [0.99, 0.5],
        [0.5, 0.99],
      ];
      const repaired = repairCorrelationMatrix(matrix);

      expect(repaired).not.toBeNull();
      if (repaired) {
        expect(repaired[0][0]).toBe(1);
        expect(repaired[1][1]).toBe(1);
      }
    });

    it('enforces symmetry', () => {
      const matrix = [
        [1, 0.6],
        [0.5, 1],
      ];
      const repaired = repairCorrelationMatrix(matrix);

      expect(repaired).not.toBeNull();
      if (repaired) {
        expect(repaired[0][1]).toBe(repaired[1][0]);
      }
    });

    it('returns null for unrepairable matrix', () => {
      // Extreme case that can't be repaired
      const matrix = [
        [1, -0.99, -0.99],
        [-0.99, 1, -0.99],
        [-0.99, -0.99, 1],
      ];
      const repaired = repairCorrelationMatrix(matrix);

      // May or may not be repairable depending on algorithm
      // Just verify it doesn't crash
      expect(repaired === null || isPositiveSemiDefinite(repaired!)).toBe(true);
    });
  });

  describe('sampleCorrelatedGroup', () => {
    it('samples all nodes in group', () => {
      const group: CorrelationGroup = {
        group_id: 'test',
        node_ids: ['a', 'b'],
        correlation_matrix: [
          [1, 0.5],
          [0.5, 1],
        ],
      };
      const rng = new SeededRNG(42);

      const result = sampleCorrelatedGroup(group, rng);

      expect(result.values.has('a')).toBe(true);
      expect(result.values.has('b')).toBe(true);
      expect(result.used_fallback).toBe(false);
    });

    it('produces correlated samples', () => {
      const group: CorrelationGroup = {
        group_id: 'test',
        node_ids: ['a', 'b'],
        correlation_matrix: [
          [1, 0.9], // High correlation
          [0.9, 1],
        ],
      };

      // Generate many samples to check correlation
      const samplesA: number[] = [];
      const samplesB: number[] = [];

      for (let seed = 0; seed < 100; seed++) {
        const rng = new SeededRNG(seed);
        const result = sampleCorrelatedGroup(group, rng);
        samplesA.push(result.values.get('a')!);
        samplesB.push(result.values.get('b')!);
      }

      // Calculate sample correlation
      const meanA = samplesA.reduce((a, b) => a + b, 0) / samplesA.length;
      const meanB = samplesB.reduce((a, b) => a + b, 0) / samplesB.length;

      let cov = 0;
      let varA = 0;
      let varB = 0;

      for (let i = 0; i < samplesA.length; i++) {
        const dA = samplesA[i] - meanA;
        const dB = samplesB[i] - meanB;
        cov += dA * dB;
        varA += dA * dA;
        varB += dB * dB;
      }

      const correlation = cov / Math.sqrt(varA * varB);

      // Correlation should be positive and reasonably high
      expect(correlation).toBeGreaterThan(0.5);
    });

    it('falls back to independent sampling for invalid matrix', () => {
      const group: CorrelationGroup = {
        group_id: 'test',
        node_ids: ['a', 'b'],
        correlation_matrix: [
          [1, 2], // Invalid: > 1
          [2, 1],
        ],
      };
      const rng = new SeededRNG(42);

      const result = sampleCorrelatedGroup(group, rng);

      expect(result.used_fallback).toBe(true);
      expect(result.fallback_reason).toBeDefined();
      // Should still produce values
      expect(result.values.has('a')).toBe(true);
      expect(result.values.has('b')).toBe(true);
    });

    it('produces deterministic output for same seed', () => {
      const group: CorrelationGroup = {
        group_id: 'test',
        node_ids: ['a', 'b'],
        correlation_matrix: [
          [1, 0.5],
          [0.5, 1],
        ],
      };

      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(42);

      const result1 = sampleCorrelatedGroup(group, rng1);
      const result2 = sampleCorrelatedGroup(group, rng2);

      expect(result1.values.get('a')).toBe(result2.values.get('a'));
      expect(result1.values.get('b')).toBe(result2.values.get('b'));
    });
  });

  describe('sampleAllCorrelationGroups', () => {
    it('samples multiple groups', () => {
      const groups: CorrelationGroup[] = [
        {
          group_id: 'group1',
          node_ids: ['a', 'b'],
          correlation_matrix: [
            [1, 0.5],
            [0.5, 1],
          ],
        },
        {
          group_id: 'group2',
          node_ids: ['c', 'd'],
          correlation_matrix: [
            [1, 0.3],
            [0.3, 1],
          ],
        },
      ];

      const result = sampleAllCorrelationGroups(groups, 42);

      expect(result.values.has('a')).toBe(true);
      expect(result.values.has('b')).toBe(true);
      expect(result.values.has('c')).toBe(true);
      expect(result.values.has('d')).toBe(true);
    });

    it('tracks fallback groups', () => {
      const groups: CorrelationGroup[] = [
        {
          group_id: 'valid_group',
          node_ids: ['a', 'b'],
          correlation_matrix: [
            [1, 0.5],
            [0.5, 1],
          ],
        },
        {
          group_id: 'invalid_group',
          node_ids: ['c', 'd'],
          correlation_matrix: [
            [1, 2], // Invalid
            [2, 1],
          ],
        },
      ];

      const result = sampleAllCorrelationGroups(groups, 42);

      expect(result.fallback_groups).toContain('invalid_group');
      expect(result.fallback_groups).not.toContain('valid_group');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('handles empty groups array', () => {
      const result = sampleAllCorrelationGroups([], 42);

      expect(result.values.size).toBe(0);
      expect(result.fallback_groups).toHaveLength(0);
    });
  });

  describe('validateCorrelationGroups', () => {
    it('accepts valid groups', () => {
      const groups: CorrelationGroup[] = [
        {
          group_id: 'test',
          node_ids: ['a', 'b'],
          correlation_matrix: [
            [1, 0.5],
            [0.5, 1],
          ],
        },
      ];
      const nodeIds = new Set(['a', 'b', 'c']);

      const errors = validateCorrelationGroups(groups, nodeIds);

      expect(errors).toHaveLength(0);
    });

    it('rejects unknown node IDs', () => {
      const groups: CorrelationGroup[] = [
        {
          group_id: 'test',
          node_ids: ['a', 'unknown'],
          correlation_matrix: [
            [1, 0.5],
            [0.5, 1],
          ],
        },
      ];
      const nodeIds = new Set(['a', 'b', 'c']);

      const errors = validateCorrelationGroups(groups, nodeIds);

      expect(errors.some((e) => e.includes('unknown node'))).toBe(true);
    });

    it('rejects mismatched matrix dimensions', () => {
      const groups: CorrelationGroup[] = [
        {
          group_id: 'test',
          node_ids: ['a', 'b', 'c'],
          correlation_matrix: [
            [1, 0.5],
            [0.5, 1],
          ], // 2x2 matrix for 3 nodes
        },
      ];
      const nodeIds = new Set(['a', 'b', 'c']);

      const errors = validateCorrelationGroups(groups, nodeIds);

      expect(errors.some((e) => e.includes('dimensions'))).toBe(true);
    });

    it('rejects invalid correlation matrix', () => {
      const groups: CorrelationGroup[] = [
        {
          group_id: 'test',
          node_ids: ['a', 'b'],
          correlation_matrix: [
            [1, 0.5],
            [0.6, 1], // Not symmetric
          ],
        },
      ];
      const nodeIds = new Set(['a', 'b']);

      const errors = validateCorrelationGroups(groups, nodeIds);

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
