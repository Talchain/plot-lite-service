import { describe, it, expect } from 'vitest';

import {
  classifyCeeSeverity,
  isBlockingError,
  describeSeverity,
  validateCodeSets,
  ERROR_CODES,
  WARNING_CODES,
  INFO_CODES,
  ALL_CEE_CODES,
} from '../src/cee/severity.js';

describe('CEE Severity Classification', () => {
  describe('ERROR_CODES', () => {
    it('classifies LIMIT_EXCEEDED as error', () => {
      expect(classifyCeeSeverity('LIMIT_EXCEEDED')).toBe('error');
      expect(isBlockingError('LIMIT_EXCEEDED')).toBe(true);
    });

    it('classifies CIRCULAR_DEPENDENCY as error', () => {
      expect(classifyCeeSeverity('CIRCULAR_DEPENDENCY')).toBe('error');
      expect(isBlockingError('CIRCULAR_DEPENDENCY')).toBe(true);
    });

    it('classifies MISSING_REQUIRED_NODE as error', () => {
      expect(classifyCeeSeverity('MISSING_REQUIRED_NODE')).toBe('error');
      expect(isBlockingError('MISSING_REQUIRED_NODE')).toBe(true);
    });

    it('classifies INVALID_WEIGHT_RANGE as error', () => {
      expect(classifyCeeSeverity('INVALID_WEIGHT_RANGE')).toBe('error');
      expect(isBlockingError('INVALID_WEIGHT_RANGE')).toBe(true);
    });

    it('classifies INVALID_BELIEF_RANGE as error', () => {
      expect(classifyCeeSeverity('INVALID_BELIEF_RANGE')).toBe('error');
      expect(isBlockingError('INVALID_BELIEF_RANGE')).toBe(true);
    });

    it('marks all ERROR_CODES as blocking', () => {
      ERROR_CODES.forEach(code => {
        expect(isBlockingError(code)).toBe(true);
      });
    });
  });

  describe('WARNING_CODES', () => {
    it('classifies MISSING_EVIDENCE as warning', () => {
      expect(classifyCeeSeverity('MISSING_EVIDENCE')).toBe('warning');
      expect(isBlockingError('MISSING_EVIDENCE')).toBe(false);
    });

    it('classifies LOW_CONFIDENCE as warning', () => {
      expect(classifyCeeSeverity('LOW_CONFIDENCE')).toBe('warning');
      expect(isBlockingError('LOW_CONFIDENCE')).toBe(false);
    });

    it('classifies POTENTIAL_COLLIDER as warning', () => {
      expect(classifyCeeSeverity('POTENTIAL_COLLIDER')).toBe('warning');
      expect(isBlockingError('POTENTIAL_COLLIDER')).toBe(false);
    });

    it('classifies OUTCOME_ORPHAN as warning', () => {
      expect(classifyCeeSeverity('OUTCOME_ORPHAN')).toBe('warning');
      expect(isBlockingError('OUTCOME_ORPHAN')).toBe(false);
    });

    it('classifies HIGH_EDGE_DENSITY as warning', () => {
      expect(classifyCeeSeverity('HIGH_EDGE_DENSITY')).toBe('warning');
      expect(isBlockingError('HIGH_EDGE_DENSITY')).toBe(false);
    });

    it('classifies STALE_EVIDENCE as warning', () => {
      expect(classifyCeeSeverity('STALE_EVIDENCE')).toBe('warning');
      expect(isBlockingError('STALE_EVIDENCE')).toBe(false);
    });

    it('marks no WARNING_CODES as blocking', () => {
      WARNING_CODES.forEach(code => {
        expect(isBlockingError(code)).toBe(false);
      });
    });
  });

  describe('INFO_CODES', () => {
    it('classifies CONSIDER_CONFOUNDER as info', () => {
      expect(classifyCeeSeverity('CONSIDER_CONFOUNDER')).toBe('info');
      expect(isBlockingError('CONSIDER_CONFOUNDER')).toBe(false);
    });

    it('classifies ASYMMETRIC_OPTIONS as info', () => {
      expect(classifyCeeSeverity('ASYMMETRIC_OPTIONS')).toBe('info');
      expect(isBlockingError('ASYMMETRIC_OPTIONS')).toBe(false);
    });

    it('classifies MISSING_RISK_NODE as info', () => {
      expect(classifyCeeSeverity('MISSING_RISK_NODE')).toBe('info');
      expect(isBlockingError('MISSING_RISK_NODE')).toBe(false);
    });

    it('classifies COULD_ADD_FACTOR as info', () => {
      expect(classifyCeeSeverity('COULD_ADD_FACTOR')).toBe('info');
      expect(isBlockingError('COULD_ADD_FACTOR')).toBe(false);
    });

    it('marks no INFO_CODES as blocking', () => {
      INFO_CODES.forEach(code => {
        expect(isBlockingError(code)).toBe(false);
      });
    });
  });

  describe('Unknown codes', () => {
    it('defaults unknown codes to warning', () => {
      expect(classifyCeeSeverity('UNKNOWN_CODE')).toBe('warning');
      expect(classifyCeeSeverity('TYPO_ERROR')).toBe('warning');
      expect(classifyCeeSeverity('FUTURE_CODE')).toBe('warning');
    });

    it('treats unknown codes as non-blocking', () => {
      expect(isBlockingError('UNKNOWN_CODE')).toBe(false);
      expect(isBlockingError('')).toBe(false);
    });
  });

  describe('Code set validation', () => {
    it('exposes non-empty code sets', () => {
      expect(ERROR_CODES.size).toBeGreaterThan(0);
      expect(WARNING_CODES.size).toBeGreaterThan(0);
      expect(INFO_CODES.size).toBeGreaterThan(0);
    });

    it('has the expected number of codes in each set', () => {
      expect(ERROR_CODES.size).toBe(5);
      expect(WARNING_CODES.size).toBe(6);
      expect(INFO_CODES.size).toBe(4);
    });

    it('ALL_CEE_CODES contains all codes', () => {
      expect(ALL_CEE_CODES.size).toBe(ERROR_CODES.size + WARNING_CODES.size + INFO_CODES.size);

      ERROR_CODES.forEach(code => expect(ALL_CEE_CODES.has(code)).toBe(true));
      WARNING_CODES.forEach(code => expect(ALL_CEE_CODES.has(code)).toBe(true));
      INFO_CODES.forEach(code => expect(ALL_CEE_CODES.has(code)).toBe(true));
    });

    it('confirms there is no overlap between sets', () => {
      const result = validateCodeSets();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Severity descriptions', () => {
    it('provides description for error severity', () => {
      const desc = describeSeverity('error');
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('blocking');
    });

    it('provides description for warning severity', () => {
      const desc = describeSeverity('warning');
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('review');
    });

    it('provides description for info severity', () => {
      const desc = describeSeverity('info');
      expect(desc).toBeTruthy();
      expect(desc.toLowerCase()).toContain('suggest');
    });
  });

  describe('Edge cases', () => {
    it('handles empty string code', () => {
      expect(classifyCeeSeverity('')).toBe('warning');
      expect(isBlockingError('')).toBe(false);
    });

    it('is case-sensitive for codes', () => {
      // Unknown casing should fall back to warning
      expect(classifyCeeSeverity('limit_exceeded')).toBe('warning');
      expect(classifyCeeSeverity('LIMIT_EXCEEDED')).toBe('error');
    });
  });
});
