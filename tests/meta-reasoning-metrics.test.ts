/**
 * Tests for meta-reasoning quality metrics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initializeHistograms,
  resetHistograms,
  renderHistograms,
  recordMetaReasoningMetrics,
  observeMetaQuality,
  recordMetaConfidence,
  recordMetaStability,
  recordMetaConvergence,
} from '../src/metrics/registry.js';

describe('Meta-Reasoning Quality Metrics', () => {
  let origPrometheus: string | undefined;

  beforeEach(() => {
    origPrometheus = process.env.PROMETHEUS_ENABLE;
    process.env.PROMETHEUS_ENABLE = '1';
    initializeHistograms();
    resetHistograms();
  });

  afterEach(() => {
    if (origPrometheus !== undefined) {
      process.env.PROMETHEUS_ENABLE = origPrometheus;
    } else {
      delete process.env.PROMETHEUS_ENABLE;
    }
    resetHistograms();
  });

  describe('observeMetaQuality', () => {
    it('records quality score histogram', () => {
      observeMetaQuality('model_of_inference', 0.85);
      const output = renderHistograms();
      expect(output).toContain('plot_engine_meta_quality_score');
      expect(output).toContain('engine="model_of_inference"');
    });
  });

  describe('recordMetaConfidence', () => {
    it('records high confidence level', () => {
      recordMetaConfidence('model_of_inference', 'high');
      const output = renderHistograms();
      expect(output).toContain('plot_engine_meta_confidence_total');
      expect(output).toContain('level="high"');
    });

    it('records medium confidence level', () => {
      recordMetaConfidence('model_of_inference', 'medium');
      const output = renderHistograms();
      expect(output).toContain('level="medium"');
    });

    it('records low confidence level', () => {
      recordMetaConfidence('model_of_inference', 'low');
      const output = renderHistograms();
      expect(output).toContain('level="low"');
    });
  });

  describe('recordMetaStability', () => {
    it('records stable estimate stability', () => {
      recordMetaStability('model_of_inference', 'stable');
      const output = renderHistograms();
      expect(output).toContain('plot_engine_meta_stability_total');
      expect(output).toContain('stability="stable"');
    });

    it('records moderate estimate stability', () => {
      recordMetaStability('model_of_inference', 'moderate');
      const output = renderHistograms();
      expect(output).toContain('stability="moderate"');
    });

    it('records volatile estimate stability', () => {
      recordMetaStability('model_of_inference', 'volatile');
      const output = renderHistograms();
      expect(output).toContain('stability="volatile"');
    });
  });

  describe('recordMetaConvergence', () => {
    it('records converged status', () => {
      recordMetaConvergence('model_of_inference', 'converged');
      const output = renderHistograms();
      expect(output).toContain('plot_engine_meta_convergence_total');
      expect(output).toContain('status="converged"');
    });

    it('records marginal status', () => {
      recordMetaConvergence('model_of_inference', 'marginal');
      const output = renderHistograms();
      expect(output).toContain('status="marginal"');
    });

    it('records not_converged status', () => {
      recordMetaConvergence('model_of_inference', 'not_converged');
      const output = renderHistograms();
      expect(output).toContain('status="not_converged"');
    });
  });

  describe('recordMetaReasoningMetrics', () => {
    it('records all metrics from quality and reliability objects', () => {
      recordMetaReasoningMetrics(
        'model_of_inference',
        { overall_score: 0.75, confidence_level: 'medium' },
        { estimate_stability: 'moderate', convergence_status: 'converged' }
      );

      const output = renderHistograms();
      expect(output).toContain('plot_engine_meta_quality_score');
      expect(output).toContain('plot_engine_meta_confidence_total');
      expect(output).toContain('plot_engine_meta_stability_total');
      expect(output).toContain('plot_engine_meta_convergence_total');
    });

    it('records multiple invocations cumulatively', () => {
      recordMetaReasoningMetrics(
        'model_of_inference',
        { overall_score: 0.9, confidence_level: 'high' },
        { estimate_stability: 'stable', convergence_status: 'converged' }
      );
      recordMetaReasoningMetrics(
        'model_of_inference',
        { overall_score: 0.5, confidence_level: 'low' },
        { estimate_stability: 'volatile', convergence_status: 'not_converged' }
      );

      const output = renderHistograms();
      // Should have recorded both high and low
      expect(output).toContain('level="high"');
      expect(output).toContain('level="low"');
    });
  });

  describe('resetHistograms', () => {
    it('clears all meta-reasoning metrics', () => {
      recordMetaReasoningMetrics(
        'model_of_inference',
        { overall_score: 0.85, confidence_level: 'high' },
        { estimate_stability: 'stable', convergence_status: 'converged' }
      );

      resetHistograms();
      const output = renderHistograms();

      // After reset, counters should show zero (empty) state
      // Histogram lines with data should not appear
      expect(output).not.toContain('level="high"');
    });
  });
});
