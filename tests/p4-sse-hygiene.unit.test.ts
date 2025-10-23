import { describe, it, expect, beforeEach } from 'vitest';
import { MonotonicIdGenerator, parseLastEventId } from '../src/lib/sse-utils.js';

describe('P4: SSE Hygiene — Unit tests', () => {
  describe('MonotonicIdGenerator', () => {
    let gen: MonotonicIdGenerator;

    beforeEach(() => {
      gen = new MonotonicIdGenerator();
    });

    it('starts at 0', () => {
      expect(gen.current_value()).toBe(0);
    });

    it('increments monotonically', () => {
      expect(gen.next()).toBe(0);
      expect(gen.next()).toBe(1);
      expect(gen.next()).toBe(2);
      expect(gen.next()).toBe(3);
    });

    it('resets to 0', () => {
      gen.next();
      gen.next();
      gen.reset();
      expect(gen.current_value()).toBe(0);
      expect(gen.next()).toBe(0);
    });

    it('handles many increments', () => {
      for (let i = 0; i < 1000; i++) {
        expect(gen.next()).toBe(i);
      }
    });
  });

  describe('parseLastEventId', () => {
    it('returns null when header absent', () => {
      const req = { headers: {} } as any;
      expect(parseLastEventId(req)).toBeNull();
    });

    it('parses valid integer', () => {
      const req = { headers: { 'last-event-id': '42' } } as any;
      expect(parseLastEventId(req)).toBe(42);
    });

    it('returns null for invalid values', () => {
      expect(parseLastEventId({ headers: { 'last-event-id': 'abc' } } as any)).toBeNull();
      expect(parseLastEventId({ headers: { 'last-event-id': '-5' } } as any)).toBeNull();
      expect(parseLastEventId({ headers: { 'last-event-id': '3.14' } } as any)).toBe(3);
    });

    it('handles zero', () => {
      const req = { headers: { 'last-event-id': '0' } } as any;
      expect(parseLastEventId(req)).toBe(0);
    });
  });
});
