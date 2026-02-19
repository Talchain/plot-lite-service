/**
 * Identical Options Deduplication Tests
 *
 * Verifies that deduplicateOptions() correctly groups options by canonical
 * intervention fingerprint, keeps the first per group, and drops the rest.
 */

import { describe, it, expect } from 'vitest';
import { deduplicateOptions, canonicaliseInterventions } from '../src/validation/identical-options.js';
import type { OptionV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOption(id: string, label: string, interventions: Record<string, number>): OptionV3 {
  return {
    id,
    label,
    interventions: Object.fromEntries(
      Object.entries(interventions).map(([k, v]) => [k, { value: v, source: 'user_specified' as const }])
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deduplicateOptions', () => {
  it('3 options, 2 identical → 2 unique + 1 dropped', () => {
    const options: OptionV3[] = [
      makeOption('opt1', 'Option 1', { 'factor-a': 1.5 }),
      makeOption('opt2', 'Option 2', { 'factor-a': 1.5 }), // same as opt1
      makeOption('opt3', 'Option 3', { 'factor-a': 2.0 }), // different
    ];

    const result = deduplicateOptions(options);

    expect(result.uniqueOptions).toHaveLength(2);
    expect(result.uniqueOptions[0].id).toBe('opt1'); // first kept
    expect(result.uniqueOptions[1].id).toBe('opt3');

    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].droppedOption.id).toBe('opt2');
    expect(result.dropped[0].keptOption.id).toBe('opt1');
  });

  it('all 3 identical → 1 unique + 2 dropped', () => {
    const options: OptionV3[] = [
      makeOption('opt1', 'Option 1', { 'factor-a': 1.5 }),
      makeOption('opt2', 'Option 2', { 'factor-a': 1.5 }),
      makeOption('opt3', 'Option 3', { 'factor-a': 1.5 }),
    ];

    const result = deduplicateOptions(options);

    expect(result.uniqueOptions).toHaveLength(1);
    expect(result.uniqueOptions[0].id).toBe('opt1');

    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0].droppedOption.id).toBe('opt2');
    expect(result.dropped[1].droppedOption.id).toBe('opt3');
  });

  it('4 options, 2 pairs → 2 unique + 2 dropped', () => {
    const options: OptionV3[] = [
      makeOption('opt1', 'Option 1', { 'factor-a': 1.5 }),     // pair A
      makeOption('opt2', 'Option 2', { 'factor-a': 1.5 }),     // pair A (dup)
      makeOption('opt3', 'Option 3', { 'factor-b': 3.0 }),     // pair B
      makeOption('opt4', 'Option 4', { 'factor-b': 3.0 }),     // pair B (dup)
    ];

    const result = deduplicateOptions(options);

    expect(result.uniqueOptions).toHaveLength(2);
    expect(result.uniqueOptions[0].id).toBe('opt1');
    expect(result.uniqueOptions[1].id).toBe('opt3');

    expect(result.dropped).toHaveLength(2);
    expect(result.dropped[0].droppedOption.id).toBe('opt2');
    expect(result.dropped[0].keptOption.id).toBe('opt1');
    expect(result.dropped[1].droppedOption.id).toBe('opt4');
    expect(result.dropped[1].keptOption.id).toBe('opt3');
  });

  it('no duplicates → all unique, nothing dropped', () => {
    const options: OptionV3[] = [
      makeOption('opt1', 'Option 1', { 'factor-a': 1.0 }),
      makeOption('opt2', 'Option 2', { 'factor-a': 2.0 }),
      makeOption('opt3', 'Option 3', { 'factor-b': 1.0 }),
    ];

    const result = deduplicateOptions(options);

    expect(result.uniqueOptions).toHaveLength(3);
    expect(result.dropped).toHaveLength(0);
  });

  it('uses canonical fingerprint (key order does not matter)', () => {
    const opt1 = makeOption('opt1', 'Option 1', { 'factor-a': 1.0, 'factor-b': 2.0 });
    // Same interventions but keys in reverse order
    const opt2: OptionV3 = {
      id: 'opt2',
      label: 'Option 2',
      interventions: {
        'factor-b': { value: 2.0, source: 'user_specified' },
        'factor-a': { value: 1.0, source: 'user_specified' },
      },
    };

    const result = deduplicateOptions([opt1, opt2]);

    expect(result.uniqueOptions).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].droppedOption.id).toBe('opt2');
  });
});
