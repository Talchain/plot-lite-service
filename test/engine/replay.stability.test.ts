import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

// This test relies on the test server that run-all-tests starts for Vitest phase.
// It runs the replay script twice back-to-back and asserts no refusals/failures.

describe('replay stability', () => {
  it('runs replay twice back-to-back with zero refusals', () => {
    const env = { ...process.env, RUN_REPLAY_STRICT: '1' };
    const r1 = spawnSync(process.execPath, ['tools/replay-fixtures.js'], { encoding: 'utf8', env });
    expect(r1.status, r1.stderr || r1.stdout || '(no output)').toBe(0);
    expect(r1.stderr || '').not.toMatch(/ECONNREFUSED/);

    const r2 = spawnSync(process.execPath, ['tools/replay-fixtures.js'], { encoding: 'utf8', env });
    expect(r2.status, r2.stderr || r2.stdout || '(no output)').toBe(0);
    expect(r2.stderr || '').not.toMatch(/ECONNREFUSED/);
  });
});
