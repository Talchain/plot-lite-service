import { describe, it, expect } from 'vitest';

describe('Full Sensitivity Analysis (Sprint N Feature 2)', () => {
  describe('computeHHI', () => {
    it('returns 0 for empty edges', async () => {
      const { computeHHI } = await import('../src/trust/sensitivity-full.js');
      expect(computeHHI([])).toBe(0);
    });

    it('returns 1 for single edge (monopoly)', async () => {
      const { computeHHI } = await import('../src/trust/sensitivity-full.js');
      const edges = [{ edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 1.0 }];
      expect(computeHHI(edges)).toBe(1);
    });

    it('returns 0.5 for two equal edges', async () => {
      const { computeHHI } = await import('../src/trust/sensitivity-full.js');
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.5 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 1, belief: 1, provenance: 'test', rank: 2, score: 0.5 },
      ];
      // (0.5/1.0)^2 + (0.5/1.0)^2 = 0.25 + 0.25 = 0.5
      expect(computeHHI(edges)).toBe(0.5);
    });

    it('returns 0.25 for four equal edges', async () => {
      const { computeHHI } = await import('../src/trust/sensitivity-full.js');
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.25 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 1, belief: 1, provenance: 'test', rank: 2, score: 0.25 },
        { edge_id: 'e3', from: 'C', to: 'D', weight: 1, belief: 1, provenance: 'test', rank: 3, score: 0.25 },
        { edge_id: 'e4', from: 'D', to: 'E', weight: 1, belief: 1, provenance: 'test', rank: 4, score: 0.25 },
      ];
      // 4 * (0.25/1.0)^2 = 4 * 0.0625 = 0.25
      expect(computeHHI(edges)).toBe(0.25);
    });

    it('returns higher HHI for concentrated distribution', async () => {
      const { computeHHI } = await import('../src/trust/sensitivity-full.js');
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.8 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 1, belief: 1, provenance: 'test', rank: 2, score: 0.1 },
        { edge_id: 'e3', from: 'C', to: 'D', weight: 1, belief: 1, provenance: 'test', rank: 3, score: 0.1 },
      ];
      // (0.8/1.0)^2 + (0.1/1.0)^2 + (0.1/1.0)^2 = 0.64 + 0.01 + 0.01 = 0.66
      expect(computeHHI(edges)).toBe(0.66);
    });

    it('handles zero total score', async () => {
      const { computeHHI } = await import('../src/trust/sensitivity-full.js');
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 0, belief: 0, provenance: 'test', rank: 1, score: 0 },
      ];
      expect(computeHHI(edges)).toBe(0);
    });
  });

  describe('classifyConcentration', () => {
    it('returns "high" for HHI >= 0.25', async () => {
      const { classifyConcentration } = await import('../src/trust/sensitivity-full.js');
      expect(classifyConcentration(0.25)).toBe('high');
      expect(classifyConcentration(0.5)).toBe('high');
      expect(classifyConcentration(1.0)).toBe('high');
    });

    it('returns "medium" for 0.15 <= HHI < 0.25', async () => {
      const { classifyConcentration } = await import('../src/trust/sensitivity-full.js');
      expect(classifyConcentration(0.15)).toBe('medium');
      expect(classifyConcentration(0.20)).toBe('medium');
      expect(classifyConcentration(0.24)).toBe('medium');
    });

    it('returns "diffuse" for HHI < 0.15', async () => {
      const { classifyConcentration } = await import('../src/trust/sensitivity-full.js');
      expect(classifyConcentration(0.14)).toBe('diffuse');
      expect(classifyConcentration(0.10)).toBe('diffuse');
      expect(classifyConcentration(0)).toBe('diffuse');
    });
  });

  describe('countEdgesToCoverage', () => {
    it('returns 0 for empty edges', async () => {
      const { countEdgesToCoverage } = await import('../src/trust/sensitivity-full.js');
      expect(countEdgesToCoverage([], 0)).toBe(0);
    });

    it('returns 1 for single edge', async () => {
      const { countEdgesToCoverage } = await import('../src/trust/sensitivity-full.js');
      const edges = [{ edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 1.0 }];
      expect(countEdgesToCoverage(edges, 1.0)).toBe(1);
    });

    it('counts edges needed for 80% coverage', async () => {
      const { countEdgesToCoverage } = await import('../src/trust/sensitivity-full.js');
      // Sorted by score: 0.4, 0.3, 0.2, 0.1 (total = 1.0)
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.4 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 1, belief: 1, provenance: 'test', rank: 2, score: 0.3 },
        { edge_id: 'e3', from: 'C', to: 'D', weight: 1, belief: 1, provenance: 'test', rank: 3, score: 0.2 },
        { edge_id: 'e4', from: 'D', to: 'E', weight: 1, belief: 1, provenance: 'test', rank: 4, score: 0.1 },
      ];
      // 0.4 = 40%, 0.4 + 0.3 = 70%, 0.4 + 0.3 + 0.2 = 90% (>= 80%)
      expect(countEdgesToCoverage(edges, 1.0)).toBe(3);
    });

    it('handles custom coverage target', async () => {
      const { countEdgesToCoverage } = await import('../src/trust/sensitivity-full.js');
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.5 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 1, belief: 1, provenance: 'test', rank: 2, score: 0.5 },
      ];
      // For 50% target: first edge is enough
      expect(countEdgesToCoverage(edges, 1.0, 0.5)).toBe(1);
    });
  });

  describe('generateInterpretation', () => {
    it('generates high concentration message', async () => {
      const { generateInterpretation } = await import('../src/trust/sensitivity-full.js');
      const msg = generateInterpretation('high', 2, 10);
      expect(msg).toContain('High concentration');
      expect(msg).toContain('2 edges');
      expect(msg).toContain('20%');
      expect(msg).toContain('critical relationships');
    });

    it('generates medium concentration message', async () => {
      const { generateInterpretation } = await import('../src/trust/sensitivity-full.js');
      const msg = generateInterpretation('medium', 5, 10);
      expect(msg).toContain('Moderate concentration');
      expect(msg).toContain('5 edges');
    });

    it('generates diffuse concentration message', async () => {
      const { generateInterpretation } = await import('../src/trust/sensitivity-full.js');
      const msg = generateInterpretation('diffuse', 8, 10);
      expect(msg).toContain('Diffuse sensitivity');
      expect(msg).toContain('broadly distributed');
    });

    it('handles singular edge', async () => {
      const { generateInterpretation } = await import('../src/trust/sensitivity-full.js');
      const msg = generateInterpretation('high', 1, 5);
      expect(msg).toContain('1 edge (');
      expect(msg).not.toContain('1 edges');
    });
  });

  describe('computeFullSensitivity', () => {
    it('returns complete analysis for typical edges', async () => {
      const { computeFullSensitivity } = await import('../src/trust/sensitivity-full.js');

      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.5 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 0.5, belief: 1, provenance: 'test', rank: 2, score: 0.3 },
        { edge_id: 'e3', from: 'C', to: 'D', weight: 0.2, belief: 1, provenance: 'test', rank: 3, score: 0.2 },
      ];

      const result = computeFullSensitivity(edges);

      expect(result.edges).toHaveLength(3);
      expect(result.total_score).toBe(1);
      expect(result.hhi).toBeGreaterThan(0);
      expect(['high', 'medium', 'diffuse']).toContain(result.concentration);
      expect(result.edges_to_80pct).toBeGreaterThan(0);
      expect(result.interpretation).toBeTruthy();
    });

    it('sorts edges by score descending', async () => {
      const { computeFullSensitivity } = await import('../src/trust/sensitivity-full.js');

      const edges = [
        { edge_id: 'e3', from: 'C', to: 'D', weight: 0.2, belief: 1, provenance: 'test', rank: 3, score: 0.1 },
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.5 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 0.5, belief: 1, provenance: 'test', rank: 2, score: 0.3 },
      ];

      const result = computeFullSensitivity(edges);

      expect(result.edges[0].edge_id).toBe('e1');
      expect(result.edges[1].edge_id).toBe('e2');
      expect(result.edges[2].edge_id).toBe('e3');
    });

    it('handles empty edges array', async () => {
      const { computeFullSensitivity } = await import('../src/trust/sensitivity-full.js');

      const result = computeFullSensitivity([]);

      expect(result.edges).toHaveLength(0);
      expect(result.hhi).toBe(0);
      expect(result.concentration).toBe('diffuse');
      expect(result.edges_to_80pct).toBe(0);
      expect(result.total_score).toBe(0);
    });

    it('calculates correct HHI for concentrated distribution', async () => {
      const { computeFullSensitivity } = await import('../src/trust/sensitivity-full.js');

      // One edge dominates
      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 1, provenance: 'test', rank: 1, score: 0.9 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 0.1, belief: 1, provenance: 'test', rank: 2, score: 0.1 },
      ];

      const result = computeFullSensitivity(edges);

      expect(result.concentration).toBe('high');
      expect(result.hhi).toBeGreaterThan(0.25);
    });

    it('calculates correct HHI for diffuse distribution', async () => {
      const { computeFullSensitivity } = await import('../src/trust/sensitivity-full.js');

      // Many edges with equal impact
      const edges = Array.from({ length: 10 }, (_, i) => ({
        edge_id: `e${i}`,
        from: `N${i}`,
        to: `N${i + 1}`,
        weight: 0.1,
        belief: 1,
        provenance: 'test',
        rank: i + 1,
        score: 0.1,
      }));

      const result = computeFullSensitivity(edges);

      expect(result.concentration).toBe('diffuse');
      expect(result.hhi).toBeLessThan(0.15);
    });

    it('is deterministic', async () => {
      const { computeFullSensitivity } = await import('../src/trust/sensitivity-full.js');

      const edges = [
        { edge_id: 'e1', from: 'A', to: 'B', weight: 1, belief: 0.8, provenance: 'test', rank: 1, score: 0.4 },
        { edge_id: 'e2', from: 'B', to: 'C', weight: 0.5, belief: 0.9, provenance: 'test', rank: 2, score: 0.35 },
        { edge_id: 'e3', from: 'C', to: 'D', weight: 0.3, belief: 1, provenance: 'test', rank: 3, score: 0.25 },
      ];

      const result1 = computeFullSensitivity(edges);
      const result2 = computeFullSensitivity([...edges].reverse());

      expect(result1.hhi).toBe(result2.hhi);
      expect(result1.concentration).toBe(result2.concentration);
      expect(result1.total_score).toBe(result2.total_score);
    });
  });
});
