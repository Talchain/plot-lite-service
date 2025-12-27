/**
 * Unit tests for V2 identical options detection
 */

import { describe, it, expect } from 'vitest';
import {
  canonicaliseInterventions,
  checkIdenticalOptions,
} from '../src/validation/identical-options.js';
import type { OptionV3 } from '../src/types/engine-v3.js';

describe('Identical Options Detection', () => {
  describe('canonicaliseInterventions', () => {
    it('creates canonical string for interventions', () => {
      const interventions = {
        'node-b': { value: 0.5, source: 'user_specified' as const },
        'node-a': { value: 1.0, source: 'user_specified' as const },
      };

      const canonical = canonicaliseInterventions(interventions);

      // Should be sorted alphabetically by key, using | separator
      expect(canonical).toContain('node-a:');
      expect(canonical).toContain('node-b:');
      // node-a should come before node-b
      expect(canonical.indexOf('node-a')).toBeLessThan(canonical.indexOf('node-b'));
    });

    it('normalizes floating point values', () => {
      // Test that 0.1 + 0.2 (= 0.30000000000000004) is treated same as 0.3
      const interventions1 = {
        'node-a': { value: 0.1 + 0.2, source: 'user_specified' as const },
      };
      const interventions2 = {
        'node-a': { value: 0.3, source: 'user_specified' as const },
      };

      const canonical1 = canonicaliseInterventions(interventions1);
      const canonical2 = canonicaliseInterventions(interventions2);

      expect(canonical1).toBe(canonical2);
    });

    it('handles empty interventions', () => {
      const canonical = canonicaliseInterventions({});

      expect(canonical).toBe('');
    });

    it('handles integer values', () => {
      const interventions = {
        'node-a': { value: 100, source: 'user_specified' as const },
      };

      const canonical = canonicaliseInterventions(interventions);

      expect(canonical).toContain('node-a:');
      expect(canonical).toContain('100');
    });
  });

  describe('checkIdenticalOptions', () => {
    it('detects identical options', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': { value: 1.0, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': { value: 1.0, source: 'user_specified' },
          },
        },
      ];

      const result = checkIdenticalOptions(options);

      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicatePairs.length).toBe(1);
      expect(result.duplicatePairs[0]).toContain('Option 1');
      expect(result.duplicatePairs[0]).toContain('Option 2');
    });

    it('allows different interventions', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': { value: 1.0, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': { value: 2.0, source: 'user_specified' },
          },
        },
      ];

      const result = checkIdenticalOptions(options);

      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicatePairs.length).toBe(0);
    });

    it('allows different targets', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': { value: 1.0, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-b': { value: 1.0, source: 'user_specified' },
          },
        },
      ];

      const result = checkIdenticalOptions(options);

      expect(result.hasDuplicates).toBe(false);
    });

    it('detects multiple groups of identical options', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'a': { value: 1.0, source: 'user_specified' } },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: { 'a': { value: 1.0, source: 'user_specified' } },
        },
        {
          id: 'opt3',
          label: 'Option 3',
          interventions: { 'b': { value: 2.0, source: 'user_specified' } },
        },
        {
          id: 'opt4',
          label: 'Option 4',
          interventions: { 'b': { value: 2.0, source: 'user_specified' } },
        },
      ];

      const result = checkIdenticalOptions(options);

      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicatePairs.length).toBe(2);
    });

    it('handles single option', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'a': { value: 1.0, source: 'user_specified' } },
        },
      ];

      const result = checkIdenticalOptions(options);

      expect(result.hasDuplicates).toBe(false);
    });

    it('handles empty options array', () => {
      const result = checkIdenticalOptions([]);

      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicatePairs.length).toBe(0);
    });

    it('tolerates floating point differences within epsilon', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'a': { value: 0.1 + 0.2, source: 'user_specified' }, // 0.30000000000000004
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'a': { value: 0.3, source: 'user_specified' },
          },
        },
      ];

      const result = checkIdenticalOptions(options);

      // Should be treated as identical due to floating point normalization
      expect(result.hasDuplicates).toBe(true);
    });

    it('ignores source field differences', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'a': { value: 1.0, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'a': { value: 1.0, source: 'brief_extraction' }, // Different source, same value
          },
        },
      ];

      const result = checkIdenticalOptions(options);

      expect(result.hasDuplicates).toBe(true);
    });
  });
});
