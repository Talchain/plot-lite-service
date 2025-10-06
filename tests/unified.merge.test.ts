import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';

function makeZip(dir: string, name: string, manifest: any): string {
  const z = new AdmZip();
  z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
  const out = join(dir, name);
  z.writeZip(out);
  return out;
}

describe('Unified merger produces manifest and zip', () => {
  it('merges engine+ui dummy zips and writes manifest.json inside unified zip', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'unified-'));
    const uiZip = makeZip(tmp, 'ui.zip', { ui_layout_p95_ms: 123 });
    const engZip = makeZip(tmp, 'engine.zip', { engine_get_p95_ms: 5 });
    const outDir = join(tmp, 'out');
    mkdirSync(outDir);
    const r = await (await import('node:child_process')).spawnSync(process.execPath, ['tools/unified-pack.mjs', '--ui', uiZip, '--engine', engZip, '--out', outDir, '--print'], { encoding: 'utf8' });
    expect((r.status ?? 1)).toBe(0);
    const files = readdirSync(outDir);
    const zip = files.find(f => f.endsWith('.zip'));
    expect(zip).toBeTruthy();
    const unifiedZip = new AdmZip(join(outDir, zip!));
    const e = unifiedZip.getEntry('manifest.json');
    expect(e).toBeTruthy();
    const j = JSON.parse(unifiedZip.readAsText('manifest.json'));
    expect(j?.slos?.engine_get_p95_ms).toBe(5);
    expect(j?.slos?.ui_layout_p95_ms).toBe(123);
  });
});
