import { describe, it, expect, beforeEach } from 'vitest';
import { checkP95Alert, __resetP95Alert, __getP95AlertState } from '../src/lib/p95-alert.js';

describe('Rolling P95 Alert', () => {
  beforeEach(() => {
    __resetP95Alert();
  });

  it('does not warn when p95 is below threshold', () => {
    const logs: any[] = [];
    const logger = { warn: (obj: any, msg: string) => logs.push({ obj, msg }) };

    for (let i = 0; i < 10; i++) {
      checkP95Alert(50, logger);
    }

    expect(logs).toHaveLength(0);
  });

  it('warns after 5 consecutive high readings', () => {
    const logs: any[] = [];
    const logger = { warn: (obj: any, msg: string) => logs.push({ obj, msg }) };

    // 4 high readings - no warn yet
    for (let i = 0; i < 4; i++) {
      checkP95Alert(150, logger);
    }
    expect(logs).toHaveLength(0);

    // 5th high reading - should warn
    checkP95Alert(150, logger);
    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toContain('Performance alert');
    expect(logs[0].obj.p95Rolling).toBe(150);
  });

  it('resets counter when p95 drops below threshold', () => {
    const logs: any[] = [];
    const logger = { warn: (obj: any, msg: string) => logs.push({ obj, msg }) };

    // 3 high readings
    for (let i = 0; i < 3; i++) {
      checkP95Alert(150, logger);
    }

    // Drop below threshold
    checkP95Alert(50, logger);

    // 4 more high readings - should not warn (counter reset)
    for (let i = 0; i < 4; i++) {
      checkP95Alert(150, logger);
    }

    expect(logs).toHaveLength(0);
  });

  it('rate-limits warnings to 1 per hour', () => {
    const logs: any[] = [];
    const logger = { warn: (obj: any, msg: string) => logs.push({ obj, msg }) };

    // First warn
    for (let i = 0; i < 5; i++) {
      checkP95Alert(150, logger);
    }
    expect(logs).toHaveLength(1);

    // More high readings - should not warn again (cooldown)
    for (let i = 0; i < 10; i++) {
      checkP95Alert(150, logger);
    }
    expect(logs).toHaveLength(1);
  });
});
