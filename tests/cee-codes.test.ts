import { describe, it, expect } from 'vitest';
import { normalizeCeeCode, isFlagOn } from '../src/cee/codes.js';

describe('CEE Code Utilities', () => {
  describe('normalizeCeeCode', () => {
    it('categorizes health issues', () => {
      expect(normalizeCeeCode('CEE_UNAVAILABLE')).toBe('health');
      expect(normalizeCeeCode('CEE_TIMEOUT')).toBe('health');
      expect(normalizeCeeCode('SERVICE_UNAVAILABLE')).toBe('health');
      expect(normalizeCeeCode('timeout_error')).toBe('health');
    });

    it('categorizes config issues', () => {
      expect(normalizeCeeCode('CEE_CONFIG_MISSING')).toBe('config');
      expect(normalizeCeeCode('CEE_DISABLED')).toBe('config');
      expect(normalizeCeeCode('config_error')).toBe('config');
    });

    it('categorizes SDK issues', () => {
      expect(normalizeCeeCode('CEE_SDK_UNAVAILABLE')).toBe('sdk');
      expect(normalizeCeeCode('CEE_ADAPTER_ERROR')).toBe('sdk');
      expect(normalizeCeeCode('sdk_error')).toBe('sdk');
    });

    it('categorizes client issues', () => {
      expect(normalizeCeeCode('CEE_CLIENT_ERROR')).toBe('client');
      expect(normalizeCeeCode('CEE_INVALID_RESPONSE')).toBe('client');
      expect(normalizeCeeCode('CEE_FIXTURE_ERROR')).toBe('client');
      expect(normalizeCeeCode('CEE_FIXTURE_PARSE_ERROR')).toBe('client');
      expect(normalizeCeeCode('client_error')).toBe('client');
    });

    it('defaults to unknown for unrecognized codes', () => {
      expect(normalizeCeeCode('random_error')).toBe('unknown');
      expect(normalizeCeeCode('unknown')).toBe('unknown');
      expect(normalizeCeeCode('')).toBe('unknown');
    });

    it('is case-insensitive', () => {
      expect(normalizeCeeCode('cee_unavailable')).toBe('health');
      expect(normalizeCeeCode('CEE_CONFIG_MISSING')).toBe('config');
      expect(normalizeCeeCode('Cee_Client_Error')).toBe('client');
    });
  });

  describe('isFlagOn', () => {
    it('recognizes "1" as enabled', () => {
      expect(isFlagOn('1')).toBe(true);
    });

    it('recognizes "true" (case-insensitive) as enabled', () => {
      expect(isFlagOn('true')).toBe(true);
      expect(isFlagOn('True')).toBe(true);
      expect(isFlagOn('TRUE')).toBe(true);
    });

    it('treats other values as disabled', () => {
      expect(isFlagOn('0')).toBe(false);
      expect(isFlagOn('false')).toBe(false);
      expect(isFlagOn('yes')).toBe(false);
      expect(isFlagOn('on')).toBe(false);
      expect(isFlagOn('')).toBe(false);
    });

    it('treats null and undefined as disabled', () => {
      expect(isFlagOn(null)).toBe(false);
      expect(isFlagOn(undefined)).toBe(false);
    });
  });
});
