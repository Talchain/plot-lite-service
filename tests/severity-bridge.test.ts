import { describe, it, expect } from 'vitest';

import { critiqueSeverityToLevel, validationSeverityToLevel } from '../src/trust/severity-bridge.js';

describe('severity-bridge helpers', () => {
  it('maps critique severities to semantic levels', () => {
    expect(critiqueSeverityToLevel('BLOCKER')).toBe('ERROR');
    expect(critiqueSeverityToLevel('IMPROVEMENT')).toBe('WARNING');
    expect(critiqueSeverityToLevel('OBSERVATION')).toBe('INFO');
  });

  it('maps validation severities to semantic levels', () => {
    expect(validationSeverityToLevel('error')).toBe('ERROR');
    expect(validationSeverityToLevel('warning')).toBe('WARNING');
    expect(validationSeverityToLevel(undefined)).toBe('ERROR');
    expect(validationSeverityToLevel(null as any)).toBe('ERROR');
  });
});
