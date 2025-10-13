import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

function runTool(cmd: string, args: string[] = []) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.trim().split(/\r?\n/);
  const gates = lines.filter(l => l.startsWith('GATES:'));
  return { code: r.status ?? 1, gates, out };
}

describe('Gate tools emit exactly one GATES line', () => {
  it('sdk-smoke, chaos-smoke, chaos-auth-smoke, ttff-collect each one line', () => {
    const tools: Array<[string, string[]]> = [
      ['node', ['tools/sdk-smoke.mjs']],
      ['node', ['tools/chaos-smoke.mjs']],
      ['node', ['tools/chaos-auth-smoke.mjs']],
      ['node', ['tools/ttff-collect.mjs']],
    ];
    for (const [cmd, args] of tools) {
      const { gates } = runTool(cmd, args);
      expect(gates.length).toBe(1);
      expect(gates[0].startsWith('GATES:')).toBe(true);
    }
  });
});
