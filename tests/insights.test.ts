/**
 * Tests for insights block generation
 */
import { describe, it, expect } from 'vitest';
import { generateInsights, generateStructuredInsights } from '../src/trust/insights.js';

describe('generateInsights', () => {
  describe('summary generation', () => {
    it('should generate summary with increase direction', () => {
      const result = generateInsights({
        p10: 90,
        p50: 115,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.summary).toContain('increase');
      expect(result.summary).toContain('15%');
      expect(result.summary).toContain('high confidence');
    });

    it('should generate summary with decrease direction', () => {
      const result = generateInsights({
        p10: 70,
        p50: 85,
        p90: 95,
        baseline: 100,
        confidence_level: 'MEDIUM',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.6,
      });

      expect(result.summary).toContain('decrease');
      expect(result.summary).toContain('15%');
      expect(result.summary).toContain('medium confidence');
    });

    it('should truncate summary to 200 chars', () => {
      const result = generateInsights({
        p10: 50,
        p50: 150,
        p90: 250,
        baseline: 100,
        confidence_level: 'LOW',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.5,
      });

      expect(result.summary.length).toBeLessThanOrEqual(200);
    });

    it('should handle zero baseline gracefully', () => {
      const result = generateInsights({
        p10: 10,
        p50: 20,
        p90: 30,
        baseline: 0,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  describe('risks generation', () => {
    it('should include risk for critique blockers', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 2,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.risks.some(r => r.includes('2 critical issue'))).toBe(true);
    });

    it('should include risk for critique warnings', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 3,
        evidence_coverage: 0.8,
      });

      expect(result.risks.some(r => r.includes('3 warning'))).toBe(true);
    });

    it('should include risk for low evidence coverage (<30%)', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.2,
      });

      expect(result.risks.some(r => r.includes('Low evidence coverage'))).toBe(true);
    });

    it('should include risk for moderate evidence coverage (30-50%)', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.4,
      });

      expect(result.risks.some(r => r.includes('Moderate evidence coverage'))).toBe(true);
    });

    it('should include risk for low confidence', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'LOW',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.risks.some(r => r.includes('Low confidence'))).toBe(true);
    });

    it('should include risk for wide outcome range', () => {
      const result = generateInsights({
        p10: 50,
        p50: 100,
        p90: 180,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.risks.some(r => r.includes('Wide outcome range'))).toBe(true);
    });

    it('should limit risks to max 5', () => {
      const result = generateInsights({
        p10: 30,
        p50: 100,
        p90: 200,
        baseline: 100,
        confidence_level: 'LOW',
        critique_blockers: 3,
        critique_warnings: 5,
        evidence_coverage: 0.1,
      });

      expect(result.risks.length).toBeLessThanOrEqual(5);
    });

    it('should truncate each risk to 100 chars', () => {
      const result = generateInsights({
        p10: 30,
        p50: 100,
        p90: 200,
        baseline: 100,
        confidence_level: 'LOW',
        critique_blockers: 100,
        critique_warnings: 100,
        evidence_coverage: 0.1,
      });

      for (const risk of result.risks) {
        expect(risk.length).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('next_steps generation', () => {
    it('should recommend addressing blockers first', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 2,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.next_steps.some(s => s.includes('critical issues'))).toBe(true);
    });

    it('should recommend adding evidence when coverage is low', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.3,
      });

      expect(result.next_steps.some(s => s.includes('Add evidence'))).toBe(true);
    });

    it('should recommend focusing on top driver when provided', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
        top_driver_label: 'MarketDemand',
      });

      expect(result.next_steps.some(s => s.includes('MarketDemand'))).toBe(true);
    });

    it('should recommend reviewing warnings for medium confidence', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'MEDIUM',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result.next_steps.some(s => s.includes('Review warnings'))).toBe(true);
    });

    it('should say model is ready when no issues', () => {
      const result = generateInsights({
        p10: 95,
        p50: 105,
        p90: 115,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.9,
      });

      expect(result.next_steps.some(s => s.includes('ready for decision'))).toBe(true);
    });

    it('should limit next_steps to max 3', () => {
      const result = generateInsights({
        p10: 30,
        p50: 100,
        p90: 200,
        baseline: 100,
        confidence_level: 'MEDIUM',
        critique_blockers: 3,
        critique_warnings: 5,
        evidence_coverage: 0.1,
        top_driver_label: 'TestDriver',
      });

      expect(result.next_steps.length).toBeLessThanOrEqual(3);
    });

    it('should truncate each next_step to 150 chars', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
        top_driver_label: 'A'.repeat(200),
      });

      for (const step of result.next_steps) {
        expect(step.length).toBeLessThanOrEqual(150);
      }
    });
  });

  describe('output format', () => {
    it('should return all required fields', () => {
      const result = generateInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('risks');
      expect(result).toHaveProperty('next_steps');
      expect(typeof result.summary).toBe('string');
      expect(Array.isArray(result.risks)).toBe(true);
      expect(Array.isArray(result.next_steps)).toBe(true);
    });
  });

  describe('determinism', () => {
    it('should return identical results for identical inputs', () => {
      const params = {
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH' as const,
        critique_blockers: 1,
        critique_warnings: 2,
        evidence_coverage: 0.6,
        top_driver_label: 'TestDriver',
      };

      const result1 = generateInsights(params);
      const result2 = generateInsights(params);

      expect(result1).toEqual(result2);
    });
  });
});

describe('generateStructuredInsights', () => {
  const sampleNodes = [
    { id: 'price', label: 'Price', value: 100 },
    { id: 'demand', label: 'Market Demand', value: 80 },
    { id: 'revenue', label: 'Revenue', value: 150 },
  ];

  describe('basic functionality', () => {
    it('should generate summary and risks like generateInsights', () => {
      const result = generateStructuredInsights({
        p10: 90,
        p50: 115,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 1,
        critique_warnings: 2,
        evidence_coverage: 0.4,
      });

      expect(result.summary).toContain('increase');
      expect(result.summary).toContain('15%');
      expect(result.risks.some(r => typeof r === 'string' && r.includes('critical issue'))).toBe(true);
      expect(result.risks.some(r => typeof r === 'string' && r.includes('warning'))).toBe(true);
    });

    it('should return array types for risks and next_steps', () => {
      const result = generateStructuredInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
      });

      expect(Array.isArray(result.risks)).toBe(true);
      expect(Array.isArray(result.next_steps)).toBe(true);
    });
  });

  describe('structured node references', () => {
    it('should include node reference when top_driver_node_id and graph_nodes provided', () => {
      const result = generateStructuredInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
        top_driver_node_id: 'demand',
        graph_nodes: sampleNodes,
      });

      // Should have a structured insight with node_references
      const structuredStep = result.next_steps.find(
        s => typeof s === 'object' && 'node_references' in s
      );
      expect(structuredStep).toBeDefined();

      if (typeof structuredStep === 'object' && 'node_references' in structuredStep) {
        expect(structuredStep.node_references).toBeDefined();
        expect(structuredStep.node_references!.length).toBeGreaterThan(0);
        expect(structuredStep.node_references![0].node_id).toBe('demand');
        expect(structuredStep.node_references![0].node_label).toBe('Market Demand');
      }
    });

    it('should fall back to string when node_id not in graph_nodes', () => {
      const result = generateStructuredInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
        top_driver_node_id: 'unknown_node',
        top_driver_label: 'Unknown Driver',
        graph_nodes: sampleNodes,
      });

      // Should fall back to string format with label
      const stringStep = result.next_steps.find(
        s => typeof s === 'string' && s.includes('Unknown Driver')
      );
      expect(stringStep).toBeDefined();
    });

    it('should fall back to string when no graph_nodes provided', () => {
      const result = generateStructuredInsights({
        p10: 90,
        p50: 110,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH',
        critique_blockers: 0,
        critique_warnings: 0,
        evidence_coverage: 0.8,
        top_driver_label: 'Test Driver',
      });

      // Should fall back to string format
      const stringStep = result.next_steps.find(
        s => typeof s === 'string' && s.includes('Test Driver')
      );
      expect(stringStep).toBeDefined();
    });
  });

  describe('limits and formatting', () => {
    it('should limit risks to max 5', () => {
      const result = generateStructuredInsights({
        p10: 30,
        p50: 100,
        p90: 200,
        baseline: 100,
        confidence_level: 'LOW',
        critique_blockers: 3,
        critique_warnings: 5,
        evidence_coverage: 0.1,
      });

      expect(result.risks.length).toBeLessThanOrEqual(5);
    });

    it('should limit next_steps to max 3', () => {
      const result = generateStructuredInsights({
        p10: 30,
        p50: 100,
        p90: 200,
        baseline: 100,
        confidence_level: 'MEDIUM',
        critique_blockers: 3,
        critique_warnings: 5,
        evidence_coverage: 0.1,
        top_driver_node_id: 'price',
        graph_nodes: sampleNodes,
      });

      expect(result.next_steps.length).toBeLessThanOrEqual(3);
    });
  });

  describe('parity with generateInsights', () => {
    it('should produce equivalent summary and risks without structured params', () => {
      const params = {
        p10: 90,
        p50: 115,
        p90: 130,
        baseline: 100,
        confidence_level: 'HIGH' as const,
        critique_blockers: 1,
        critique_warnings: 2,
        evidence_coverage: 0.4,
        top_driver_label: 'Test Driver',
      };

      const basic = generateInsights(params);
      const structured = generateStructuredInsights(params);

      expect(structured.summary).toBe(basic.summary);
      expect(structured.risks).toEqual(basic.risks);
    });
  });
});
