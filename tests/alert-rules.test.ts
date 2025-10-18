/**
 * Alert Rules Validation Test
 * Catches metric name typos and expression errors before production
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

describe('Circuit Breaker Alert Rules', () => {
  const alertsPath = path.join(__dirname, '../monitoring/alerts/circuit-breaker.yaml');
  
  it('alert rules file exists', () => {
    expect(fs.existsSync(alertsPath)).toBe(true);
  });

  it('alert rules parse as valid YAML', () => {
    const content = fs.readFileSync(alertsPath, 'utf8');
    const parsed = yaml.parse(content);
    
    expect(parsed).toBeDefined();
    expect(parsed.groups).toBeDefined();
    expect(Array.isArray(parsed.groups)).toBe(true);
  });

  it('all alerts have required fields', () => {
    const content = fs.readFileSync(alertsPath, 'utf8');
    const parsed = yaml.parse(content);
    
    const alerts = parsed.groups.flatMap((g: any) => g.rules || []);
    
    for (const alert of alerts) {
      expect(alert.alert).toBeDefined();
      expect(alert.expr).toBeDefined();
      expect(alert.labels).toBeDefined();
      expect(alert.labels.severity).toBeDefined();
      expect(alert.labels.priority).toMatch(/^P[1-3]$/);
      expect(alert.annotations).toBeDefined();
      expect(alert.annotations.summary).toBeDefined();
      expect(alert.annotations.runbook_url).toBeDefined();
    }
  });

  it('metric names match expected patterns', () => {
    const content = fs.readFileSync(alertsPath, 'utf8');
    const parsed = yaml.parse(content);
    
    const alerts = parsed.groups.flatMap((g: any) => g.rules || []);
    const validMetrics = [
      'plot_engine_circuit_open_total',
      'plot_engine_circuit_breaker_state',
      'plot_engine_circuit_breaker_last_transition_at',
      'plot_engine_circuit_breaker_principals_tracked',
      'plot_engine_circuit_breaker_principals_capacity',
      'plot_engine_circuit_breaker_principals_open',
      'plot_engine_principal_extraction_mode',
      'plot_engine_rate_limit_429_total',
    ];
    
    for (const alert of alerts) {
      const expr = alert.expr as string;
      
      // Extract metric names from expression (word boundaries to avoid partials)
      const metricMatches = expr.match(/\bplot_engine_[a-z_]+\b/g) || [];
      
      for (const metric of metricMatches) {
        expect(validMetrics, `Unknown metric: ${metric} in alert: ${alert.alert}`).toContain(metric);
      }
    }
  });

  it('runbook URLs point to valid anchors', () => {
    const content = fs.readFileSync(alertsPath, 'utf8');
    const parsed = yaml.parse(content);
    
    const alerts = parsed.groups.flatMap((g: any) => g.rules || []);
    
    for (const alert of alerts) {
      const url = alert.annotations.runbook_url;
      expect(url).toMatch(/^https:\/\/github\.com\/.*\/docs\/ALERT_RUNBOOK\.md/);
    }
  });

  it('severity levels are valid', () => {
    const content = fs.readFileSync(alertsPath, 'utf8');
    const parsed = yaml.parse(content);
    
    const alerts = parsed.groups.flatMap((g: any) => g.rules || []);
    const validSeverities = ['critical', 'warning', 'info'];
    
    for (const alert of alerts) {
      expect(validSeverities).toContain(alert.labels.severity);
    }
  });

  it('P1 alerts have critical severity', () => {
    const content = fs.readFileSync(alertsPath, 'utf8');
    const parsed = yaml.parse(content);
    
    const alerts = parsed.groups.flatMap((g: any) => g.rules || []);
    
    for (const alert of alerts) {
      if (alert.labels.priority === 'P1') {
        expect(alert.labels.severity).toBe('critical');
      }
    }
  });
});
