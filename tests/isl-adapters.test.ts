/**
 * ISL Adapters Unit Tests
 *
 * Tests the transformation of ISL responses to PLoT format.
 */

import { describe, it, expect } from 'vitest';
import { adaptValidationResponse, createFallbackValidation } from '../src/integrations/isl/adapters/validation.js';
import { adaptSensitivityResponse, createFallbackSensitivity } from '../src/integrations/isl/adapters/sensitivity.js';
import { adaptCounterfactualResponse, createFallbackCounterfactual } from '../src/integrations/isl/adapters/counterfactual.js';
import type { ISLValidationResponse, ISLSensitivityResponse, ISLCounterfactualResponse } from '../src/integrations/isl/types/isl-types.js';

describe('ISL Adapters', () => {
  describe('adaptValidationResponse', () => {
    it('should map identifiable status correctly', () => {
      const isl: ISLValidationResponse = {
        status: 'identifiable',
        adjustment_sets: [['A', 'B']],
        minimal_adjustment_set: ['A'],
        suggestions: [],
        robustness: 'high',
      };

      const result = adaptValidationResponse(isl);

      expect(result.status).toBe('identifiable');
      expect(result.confidence).toBe('high');
      expect(result.minimal_set).toEqual(['A']);
      expect(result.adjustment_sets).toEqual([['A', 'B']]);
      expect(result.source).toBe('isl');
    });

    it('should map partially_identifiable to uncertain', () => {
      const isl: ISLValidationResponse = {
        status: 'partially_identifiable',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [
          {
            type: 'missing_edge',
            description: 'Consider adding edge X→Y',
            affected_variables: ['X', 'Y'],
            suggested_action: 'Add edge',
          },
        ],
        robustness: 'medium',
      };

      const result = adaptValidationResponse(isl);

      expect(result.status).toBe('uncertain');
      expect(result.confidence).toBe('medium');
      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].affected_nodes).toEqual(['X', 'Y']);
      expect(result.issues![0].type).toBe('missing_edge');
    });

    it('should map not_identifiable to cannot_identify', () => {
      const isl: ISLValidationResponse = {
        status: 'not_identifiable',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
        robustness: 'low',
      };

      const result = adaptValidationResponse(isl);

      expect(result.status).toBe('cannot_identify');
      expect(result.confidence).toBe('low');
    });

    it('should generate meaningful explanation for identifiable', () => {
      const isl: ISLValidationResponse = {
        status: 'identifiable',
        adjustment_sets: [['Confounder']],
        minimal_adjustment_set: ['Confounder'],
        suggestions: [],
        robustness: 'high',
      };

      const result = adaptValidationResponse(isl);

      expect(result.explanation?.summary).toContain('identifiable');
      expect(result.explanation?.summary).toContain('1 adjustment');
      expect(result.explanation?.reasoning).toContain('Confounder');
    });

    it('should generate explanation for identifiable without adjustment', () => {
      const isl: ISLValidationResponse = {
        status: 'identifiable',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
        robustness: 'high',
      };

      const result = adaptValidationResponse(isl);

      expect(result.explanation?.summary).toContain('without adjustment');
      expect(result.explanation?.reasoning).toContain('No backdoor paths');
    });

    it('should omit empty adjustment_sets and minimal_set', () => {
      const isl: ISLValidationResponse = {
        status: 'not_identifiable',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
        robustness: 'low',
      };

      const result = adaptValidationResponse(isl);

      expect(result.adjustment_sets).toBeUndefined();
      expect(result.minimal_set).toBeUndefined();
    });

    it('should omit empty issues array', () => {
      const isl: ISLValidationResponse = {
        status: 'identifiable',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
        robustness: 'high',
      };

      const result = adaptValidationResponse(isl);

      expect(result.issues).toBeUndefined();
    });
  });

  describe('createFallbackValidation', () => {
    it('should create fallback with reason', () => {
      const result = createFallbackValidation('Connection timeout');

      expect(result.status).toBe('uncertain');
      expect(result.confidence).toBe('low');
      expect(result.source).toBe('engine_fallback');
      expect(result.explanation?.reasoning).toContain('Connection timeout');
    });
  });

  describe('adaptSensitivityResponse', () => {
    it('should transform sensitivities to sensitive_parameters', () => {
      const isl: ISLSensitivityResponse = {
        sensitivities: [
          { parameter: 'price', sensitivity_score: 0.8, direction: 'negative', confidence_interval: [0.6, 1.0] },
          { parameter: 'quality', sensitivity_score: 0.3, direction: 'positive', confidence_interval: [0.1, 0.5] },
        ],
        overall_robustness: 'moderate',
        recommendations: ['Consider price sensitivity'],
        analysis_metadata: { method: 'monte_carlo', samples: 1000 },
      };

      const result = adaptSensitivityResponse(isl);

      expect(result.sensitive_parameters).toHaveLength(2);
      expect(result.sensitive_parameters[0].parameter).toBe('price');
      expect(result.sensitive_parameters[0].sensitivity).toBe(0.8);
      expect(result.sensitive_parameters[0].impact_direction).toBe('negative');
      expect(result.overall_robustness).toBe('moderate');
      expect(result.recommendations).toEqual(['Consider price sensitivity']);
      expect(result.source).toBe('isl');
    });

    it('should sort by sensitivity descending', () => {
      const isl: ISLSensitivityResponse = {
        sensitivities: [
          { parameter: 'low', sensitivity_score: 0.1, direction: 'positive', confidence_interval: [0, 0.2] },
          { parameter: 'high', sensitivity_score: 0.9, direction: 'negative', confidence_interval: [0.8, 1.0] },
          { parameter: 'mid', sensitivity_score: 0.5, direction: 'positive', confidence_interval: [0.4, 0.6] },
        ],
        overall_robustness: 'fragile',
        recommendations: [],
        analysis_metadata: { method: 'monte_carlo', samples: 1000 },
      };

      const result = adaptSensitivityResponse(isl);

      expect(result.sensitive_parameters[0].parameter).toBe('high');
      expect(result.sensitive_parameters[1].parameter).toBe('mid');
      expect(result.sensitive_parameters[2].parameter).toBe('low');
    });

    it('should handle mixed direction as positive', () => {
      const isl: ISLSensitivityResponse = {
        sensitivities: [
          { parameter: 'mixed_var', sensitivity_score: 0.5, direction: 'mixed', confidence_interval: [0.3, 0.7] },
        ],
        overall_robustness: 'moderate',
        recommendations: [],
        analysis_metadata: { method: 'monte_carlo', samples: 1000 },
      };

      const result = adaptSensitivityResponse(isl);

      expect(result.sensitive_parameters[0].impact_direction).toBe('positive');
    });

    it('should preserve all robustness levels', () => {
      const robustnessLevels: Array<ISLSensitivityResponse['overall_robustness']> = ['robust', 'moderate', 'fragile'];

      for (const level of robustnessLevels) {
        const isl: ISLSensitivityResponse = {
          sensitivities: [],
          overall_robustness: level,
          recommendations: [],
          analysis_metadata: { method: 'monte_carlo', samples: 1000 },
        };

        const result = adaptSensitivityResponse(isl);
        expect(result.overall_robustness).toBe(level);
      }
    });
  });

  describe('createFallbackSensitivity', () => {
    it('should create fallback with reason', () => {
      const result = createFallbackSensitivity('ISL not available');

      expect(result.overall_robustness).toBe('moderate');
      expect(result.sensitive_parameters).toEqual([]);
      expect(result.source).toBe('engine_fallback');
      expect(result.recommendations[0]).toContain('ISL not available');
    });
  });

  describe('adaptCounterfactualResponse', () => {
    it('should map CI to p-bands', () => {
      const isl: ISLCounterfactualResponse = {
        estimate: 100,
        confidence_interval: { lower: 80, upper: 120, level: 0.95 },
        uncertainty_decomposition: { parametric: 0.1, structural: 0.2, stochastic: 0.15 },
        sensitivity_range: { min: 70, max: 130 },
      };

      const result = adaptCounterfactualResponse(isl);

      expect(result.estimate).toBe(100);
      expect(result.confidence_interval.p10).toBe(80);
      expect(result.confidence_interval.p50).toBe(100);
      expect(result.confidence_interval.p90).toBe(120);
      expect(result.source).toBe('isl');
    });

    it('should calculate total uncertainty correctly', () => {
      const isl: ISLCounterfactualResponse = {
        estimate: 50,
        confidence_interval: { lower: 40, upper: 60, level: 0.95 },
        uncertainty_decomposition: { parametric: 0.3, structural: 0.4, stochastic: 0.0 },
        sensitivity_range: { min: 35, max: 65 },
      };

      const result = adaptCounterfactualResponse(isl);

      // sqrt(0.3² + 0.4² + 0²) = sqrt(0.09 + 0.16) = sqrt(0.25) = 0.5
      expect(result.uncertainty.total).toBeCloseTo(0.5, 2);
      expect(result.uncertainty.breakdown.parametric).toBe(0.3);
      expect(result.uncertainty.breakdown.structural).toBe(0.4);
      expect(result.uncertainty.breakdown.stochastic).toBe(0.0);
    });

    it('should handle zero uncertainty', () => {
      const isl: ISLCounterfactualResponse = {
        estimate: 100,
        confidence_interval: { lower: 100, upper: 100, level: 0.95 },
        uncertainty_decomposition: { parametric: 0, structural: 0, stochastic: 0 },
        sensitivity_range: { min: 100, max: 100 },
      };

      const result = adaptCounterfactualResponse(isl);

      expect(result.uncertainty.total).toBe(0);
    });
  });

  describe('createFallbackCounterfactual', () => {
    it('should create fallback with default values', () => {
      const result = createFallbackCounterfactual('Network error');

      expect(result.estimate).toBe(0);
      expect(result.confidence_interval.p10).toBe(0);
      expect(result.confidence_interval.p50).toBe(0);
      expect(result.confidence_interval.p90).toBe(0);
      expect(result.uncertainty.total).toBe(1);
      expect(result.source).toBe('engine_fallback');
    });
  });
});
