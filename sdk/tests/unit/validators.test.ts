import { describe, it, expect } from 'vitest';
import { validatePriors, validateEvidence, validateTimeslices } from '../../src/validators';

describe('Priors Validation', () => {
  const nodeIds = new Set(['A', 'B', 'C']);

  it('accepts valid number priors', () => {
    const result = validatePriors({ A: 0.6, B: 0.3 }, nodeIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid distribution priors', () => {
    const result = validatePriors({ A: { mean: 0.6, sd: 0.1 } }, nodeIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects out-of-range number priors', () => {
    const result = validatePriors({ A: 1.5 }, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('priors.A');
    expect(result.errors[0].message).toContain('between 0 and 1');
  });

  it('rejects negative sd in distribution priors', () => {
    const result = validatePriors({ A: { mean: 0.5, sd: -0.1 } }, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('priors.A.sd');
    expect(result.errors[0].message).toContain('> 0');
  });

  it('rejects priors for unknown nodes', () => {
    const result = validatePriors({ Z: 0.5 }, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('priors.Z');
    expect(result.errors[0].message).toContain('unknown node');
  });

  it('rejects non-finite values', () => {
    const result = validatePriors({ A: NaN }, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('finite');
  });
});

describe('Evidence Validation', () => {
  const nodeIds = new Set(['A', 'B', 'C']);

  it('accepts valid evidence', () => {
    const evidence = [
      { node_id: 'A', source: 'survey_2024' },
      { node_id: 'B', source: 'expert_panel', weight: 0.8 }
    ];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects evidence with missing node_id', () => {
    const evidence = [{ source: 'test' } as any];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('evidence[0].node_id');
  });

  it('rejects evidence with missing source', () => {
    const evidence = [{ node_id: 'A' } as any];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('evidence[0].source');
  });

  it('rejects evidence for unknown nodes', () => {
    const evidence = [{ node_id: 'Z', source: 'test' }];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('evidence[0].node_id');
    expect(result.errors[0].message).toContain('unknown node');
  });

  it('rejects source longer than 200 characters', () => {
    const evidence = [{ node_id: 'A', source: 'x'.repeat(201) }];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('evidence[0].source');
    expect(result.errors[0].message).toContain('200');
  });

  it('rejects note longer than 500 characters', () => {
    const evidence = [{ node_id: 'A', source: 'test', note: 'x'.repeat(501) }];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('evidence[0].note');
    expect(result.errors[0].message).toContain('500');
  });

  it('rejects invalid weight', () => {
    const evidence = [{ node_id: 'A', source: 'test', weight: 1.5 }];
    const result = validateEvidence(evidence, nodeIds);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('evidence[0].weight');
    expect(result.errors[0].message).toContain('between 0 and 1');
  });
});

describe('Timeslices Validation', () => {
  it('accepts valid timeslices', () => {
    const result = validateTimeslices(['Q1', 'Q2', 'Q3']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects more than 12 timeslices', () => {
    const timeslices = Array(13).fill(0).map((_, i) => `T${i}`);
    const result = validateTimeslices(timeslices);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('12');
  });

  it('rejects empty timeslices array', () => {
    const result = validateTimeslices([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('empty');
  });

  it('rejects non-array timeslices', () => {
    const result = validateTimeslices('not-an-array' as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('array');
  });
});
