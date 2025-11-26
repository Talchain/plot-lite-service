import { describe, it, expect } from 'vitest';

describe('Evidence Analysis (Sprint N Feature 1)', () => {
  describe('isEvidenceBacked', () => {
    it('returns false for template provenance', async () => {
      const { isEvidenceBacked } = await import('../src/trust/evidence-analysis.js');
      expect(isEvidenceBacked('template')).toBe(false);
      expect(isEvidenceBacked('Template')).toBe(false);
      expect(isEvidenceBacked('TEMPLATE')).toBe(false);
    });

    it('returns false for assumption provenance', async () => {
      const { isEvidenceBacked } = await import('../src/trust/evidence-analysis.js');
      expect(isEvidenceBacked('assumption')).toBe(false);
      expect(isEvidenceBacked('Assumption')).toBe(false);
    });

    it('returns false for undefined/empty provenance', async () => {
      const { isEvidenceBacked } = await import('../src/trust/evidence-analysis.js');
      expect(isEvidenceBacked(undefined)).toBe(false);
      expect(isEvidenceBacked('')).toBe(false);
      expect(isEvidenceBacked('  ')).toBe(false);
    });

    it('returns true for evidence-based provenance', async () => {
      const { isEvidenceBacked } = await import('../src/trust/evidence-analysis.js');
      expect(isEvidenceBacked('study_2024')).toBe(true);
      expect(isEvidenceBacked('expert:dr_smith')).toBe(true);
      expect(isEvidenceBacked('historical_data')).toBe(true);
      expect(isEvidenceBacked('survey_results')).toBe(true);
    });
  });

  describe('analyseEvidence', () => {
    it('categorises edges by evidence backing', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'study_2024' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'template' },
          { id: 'e3', from: 'C', to: 'D', provenance: 'expert_estimate' },
          { id: 'e4', from: 'D', to: 'E', provenance: 'assumption' },
        ],
        top_drivers: [],
      });

      expect(result.evidence_backed_edges).toContain('e1');
      expect(result.evidence_backed_edges).toContain('e3');
      expect(result.assumption_edges).toContain('e2');
      expect(result.assumption_edges).toContain('e4');
    });

    it('calculates coverage percentage correctly', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      // 2 out of 4 edges have evidence
      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'study_2024' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'template' },
          { id: 'e3', from: 'C', to: 'D', provenance: 'expert' },
          { id: 'e4', from: 'D', to: 'E', provenance: 'assumption' },
        ],
        top_drivers: [],
      });

      expect(result.coverage_pct).toBe(50);
    });

    it('handles 100% coverage', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'study' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'expert' },
        ],
        top_drivers: [],
      });

      expect(result.coverage_pct).toBe(100);
      expect(result.assumption_edges).toHaveLength(0);
    });

    it('handles 0% coverage', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'template' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'assumption' },
        ],
        top_drivers: [],
      });

      expect(result.coverage_pct).toBe(0);
      expect(result.evidence_backed_edges).toHaveLength(0);
    });

    it('handles empty edges array', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [],
        top_drivers: [],
      });

      expect(result.coverage_pct).toBe(0);
      expect(result.evidence_backed_edges).toHaveLength(0);
      expect(result.assumption_edges).toHaveLength(0);
      expect(result.critical_gaps).toHaveLength(0);
    });

    it('identifies critical gaps in top drivers', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'template' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'study_2024' },
          { id: 'e3', from: 'C', to: 'D', provenance: 'assumption' },
        ],
        top_drivers: [
          { edge_id: 'e1', score: 0.85 },
          { edge_id: 'e2', score: 0.72 },
          { edge_id: 'e3', score: 0.45 },
        ],
      });

      // e1 and e3 are assumption-based and are top drivers
      expect(result.critical_gaps).toHaveLength(2);
      expect(result.critical_gaps[0].edge_id).toBe('e1');
      expect(result.critical_gaps[0].reason).toContain('0.85');
      expect(result.critical_gaps[0].reason).toContain('template');
      expect(result.critical_gaps[1].edge_id).toBe('e3');
    });

    it('limits critical gaps to max 3', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'template' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'template' },
          { id: 'e3', from: 'C', to: 'D', provenance: 'template' },
          { id: 'e4', from: 'D', to: 'E', provenance: 'template' },
          { id: 'e5', from: 'E', to: 'F', provenance: 'template' },
        ],
        top_drivers: [
          { edge_id: 'e1', score: 0.9 },
          { edge_id: 'e2', score: 0.8 },
          { edge_id: 'e3', score: 0.7 },
          { edge_id: 'e4', score: 0.6 },
          { edge_id: 'e5', score: 0.5 },
        ],
      });

      expect(result.critical_gaps).toHaveLength(3);
    });

    it('skips evidence-backed edges in critical gaps', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'study_2024' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'expert' },
        ],
        top_drivers: [
          { edge_id: 'e1', score: 0.9 },
          { edge_id: 'e2', score: 0.8 },
        ],
      });

      expect(result.critical_gaps).toHaveLength(0);
    });

    it('returns deterministic sorted results', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const edges = [
        { id: 'z_edge', from: 'Z', to: 'A', provenance: 'template' },
        { id: 'a_edge', from: 'A', to: 'B', provenance: 'template' },
        { id: 'm_edge', from: 'M', to: 'N', provenance: 'study' },
      ];

      const result1 = analyseEvidence({ edges, top_drivers: [] });
      const result2 = analyseEvidence({ edges: [...edges].reverse(), top_drivers: [] });

      // Results should be sorted identically regardless of input order
      expect(result1.assumption_edges).toEqual(result2.assumption_edges);
      expect(result1.evidence_backed_edges).toEqual(result2.evidence_backed_edges);
    });

    it('handles undefined provenance as assumption', async () => {
      const { analyseEvidence } = await import('../src/trust/evidence-analysis.js');

      const result = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B' }, // no provenance
          { id: 'e2', from: 'B', to: 'C', provenance: undefined },
        ],
        top_drivers: [
          { edge_id: 'e1', score: 0.5 },
        ],
      });

      expect(result.assumption_edges).toHaveLength(2);
      expect(result.critical_gaps).toHaveLength(1);
      expect(result.critical_gaps[0].reason).toContain('unspecified');
    });
  });

  describe('summariseEvidenceAnalysis', () => {
    it('generates readable summary for partial coverage', async () => {
      const { analyseEvidence, summariseEvidenceAnalysis } = await import('../src/trust/evidence-analysis.js');

      const analysis = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'study' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'template' },
        ],
        top_drivers: [{ edge_id: 'e2', score: 0.9 }],
      });

      const summary = summariseEvidenceAnalysis(analysis);

      expect(summary).toContain('50%');
      expect(summary).toContain('1/2');
      expect(summary).toContain('1 critical gap');
    });

    it('generates summary for full coverage', async () => {
      const { analyseEvidence, summariseEvidenceAnalysis } = await import('../src/trust/evidence-analysis.js');

      const analysis = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'study' },
        ],
        top_drivers: [],
      });

      const summary = summariseEvidenceAnalysis(analysis);

      expect(summary).toContain('100%');
      expect(summary).not.toContain('critical gap');
    });

    it('generates summary for empty graph', async () => {
      const { analyseEvidence, summariseEvidenceAnalysis } = await import('../src/trust/evidence-analysis.js');

      const analysis = analyseEvidence({
        edges: [],
        top_drivers: [],
      });

      const summary = summariseEvidenceAnalysis(analysis);

      expect(summary).toContain('No edges');
    });

    it('pluralises critical gaps correctly', async () => {
      const { analyseEvidence, summariseEvidenceAnalysis } = await import('../src/trust/evidence-analysis.js');

      const analysis = analyseEvidence({
        edges: [
          { id: 'e1', from: 'A', to: 'B', provenance: 'template' },
          { id: 'e2', from: 'B', to: 'C', provenance: 'template' },
          { id: 'e3', from: 'C', to: 'D', provenance: 'template' },
        ],
        top_drivers: [
          { edge_id: 'e1', score: 0.9 },
          { edge_id: 'e2', score: 0.8 },
          { edge_id: 'e3', score: 0.7 },
        ],
      });

      const summary = summariseEvidenceAnalysis(analysis);

      expect(summary).toContain('3 critical gaps');
    });
  });
});
