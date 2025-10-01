import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('pack-locate --json', () => {
  it('prints a JSON object with path:string', () => {
    const r = spawnSync(process.execPath, ['tools/pack-locate.mjs', '--json'], { encoding: 'utf8' });
    expect(r.status ?? 1).toBe(0);
    const j = JSON.parse(r.stdout.trim() || '{}');
    expect(typeof j.path).toBe('string');
  });
});
