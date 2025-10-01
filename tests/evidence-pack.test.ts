/**
 * Evidence Pack smoke tests (run after pack generation)
 * These tests are skipped in CI unless a pack is present locally.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK_BASE = 'artifact';

function findLatestPack(): string | null {
  if (!existsSync(PACK_BASE)) return null;
  const entries = readdirSync(PACK_BASE, { withFileTypes: true });
  const packs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('Evidence-Pack-'))
    .map(e => e.name)
    .sort()
    .reverse();
  return packs.length > 0 ? join(PACK_BASE, packs[0]) : null;
}

describe('Evidence Pack (local only)', () => {
  const packDir = findLatestPack();

  it.skipIf(!packDir)('SLO_SUMMARY.md contains privacy phrase', () => {
    if (!packDir) return;
    const summaryPath = join(packDir, 'SLO_SUMMARY.md');
    if (!existsSync(summaryPath)) {
      console.warn('SLO_SUMMARY.md not found; skipping');
      return;
    }
    const content = readFileSync(summaryPath, 'utf8');
    expect(content.toLowerCase()).toContain('no request bodies or query strings in logs');
  });

  it.skipIf(!packDir)('manifest.json has required fields', () => {
    if (!packDir) return;
    const manifestPath = join(packDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.warn('manifest.json not found; skipping');
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    
    // STRICT p95
    expect(manifest.slos?.engine_get_p95_ms).toBeTypeOf('number');
    expect(manifest.slos.engine_get_p95_ms).toBeGreaterThan(0);
    
    // Privacy marker
    expect(manifest.privacy?.no_queries_in_logs).toBe(true);
    
    // features_on is array and sorted
    expect(Array.isArray(manifest.features_on)).toBe(true);
    const sorted = [...manifest.features_on].sort();
    expect(manifest.features_on).toEqual(sorted);
    
    // Checksums present
    expect(Array.isArray(manifest.checksums)).toBe(true);
    expect(manifest.checksums.length).toBeGreaterThan(0);
  });
});
