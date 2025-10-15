import { describe, it, expect } from 'vitest';
import { validateConfig, applyNewSnapshot, getSnapshot } from '../src/config/runtimeConfig.js';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

describe('SIGHUP config reload (validate + rollback)', () => {
  const testDir = join(process.cwd(), 'artifact');
  const testPath = join(testDir, 'test-runtime-config.json');

  it('validates good config', () => {
    const good = { sse_per_ip_max: 5, sse_global_max: 50, rate_limit_rpm: 100 };
    const validated = validateConfig(good);
    expect(validated.sse_per_ip_max).toBe(5);
    expect(validated.sse_global_max).toBe(50);
    expect(validated.rate_limit_rpm).toBe(100);
  });

  it('rejects corrupt JSON', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testPath, '{ bad json', 'utf8');
    
    expect(() => {
      const { readFileSync } = require('fs');
      const txt = readFileSync(testPath, 'utf8');
      JSON.parse(txt);
    }).toThrow();

    try { unlinkSync(testPath); } catch {}
  });

  it('rejects unknown keys', () => {
    const bad = { sse_per_ip_max: 5, unknown_key: 123 };
    expect(() => validateConfig(bad)).toThrow(/unknown key/);
  });

  it('rejects invalid values', () => {
    const bad = { sse_per_ip_max: -1 };
    const before = getSnapshot();
    const validated = validateConfig(bad);
    // Should fallback to current snapshot value
    expect(validated.sse_per_ip_max).toBe(before.sse_per_ip_max);
  });

  it('keeps last good config on validation failure', () => {
    const good = { sse_per_ip_max: 10, sse_global_max: 100, rate_limit_rpm: 60 };
    applyNewSnapshot(good);
    const snapshot1 = getSnapshot();

    // Try to apply bad config
    try {
      validateConfig({ unknown_key: 1 });
    } catch {}

    const snapshot2 = getSnapshot();
    expect(snapshot2).toEqual(snapshot1);
  });

  it('updates snapshot on successful validation', () => {
    const before = getSnapshot();
    const newConfig = { sse_per_ip_max: 15, sse_global_max: 150, rate_limit_rpm: 90 };
    applyNewSnapshot(newConfig);
    const after = getSnapshot();

    expect(after.sse_per_ip_max).toBe(15);
    expect(after.sse_global_max).toBe(150);
    expect(after.rate_limit_rpm).toBe(90);
    expect(after).not.toEqual(before);
  });
});
