import { describe, it, expect } from 'vitest';
import { generateIdentifiabilityTag } from '../src/trust/identifiability-tag.js';

describe('Identifiability Tag (IDENT_TAG_ENABLE=1)', () => {
  it('Decision-ready: clean path', () => {
    const tag = generateIdentifiabilityTag({
      identifiable: true,
      has_backdoor_paths: false,
      adjustment_set_size: 0,
    });
    expect(tag).toContain('Decision-ready');
    expect(tag).toContain('Clean causal path');
  });

  it('Decision-ready: with adjustments', () => {
    const tag = generateIdentifiabilityTag({
      identifiable: true,
      has_backdoor_paths: true,
      adjustment_set_size: 2,
    });
    expect(tag).toContain('Decision-ready');
    expect(tag).toContain('2 adjustments');
  });

  it('Exploratory: backdoor paths', () => {
    const tag = generateIdentifiabilityTag({
      identifiable: false,
      has_backdoor_paths: true,
      adjustment_set_size: 0,
    });
    expect(tag).toContain('Exploratory');
    expect(tag).toContain('backdoor');
  });

  it('Exploratory: no path', () => {
    const tag = generateIdentifiabilityTag({
      identifiable: false,
      has_backdoor_paths: false,
      adjustment_set_size: 0,
    });
    expect(tag).toContain('Exploratory');
    expect(tag).toContain('No causal path');
  });
});
