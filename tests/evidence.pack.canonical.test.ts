import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('Evidence Pack canonical structure', () => {
  const evidenceDir = join(process.cwd(), 'artifact', 'pack', 'evidence');

  // Skip if not in CI or if evidence pack hasn't been built
  const shouldRun = process.env.CI === 'true' || existsSync(evidenceDir);

  it.skipIf(!shouldRun)('evidence/ directory exists', () => {
    expect(existsSync(evidenceDir)).toBe(true);
  });

  it.skipIf(!shouldRun)('pack-meta.json exists and is valid JSON', () => {
    const metaPath = join(evidenceDir, 'pack-meta.json');
    expect(existsSync(metaPath)).toBe(true);

    const content = readFileSync(metaPath, 'utf-8');
    const json = JSON.parse(content);

    // Required fields
    expect(json).toHaveProperty('commit');
    expect(json).toHaveProperty('build_timestamp');
    expect(json).toHaveProperty('flags');
    expect(typeof json.commit).toBe('string');
    expect(typeof json.build_timestamp).toBe('string');
    expect(typeof json.flags).toBe('object');
  });

  it.skipIf(!shouldRun)('slos.live.json exists and is valid JSON', () => {
    const slosPath = join(evidenceDir, 'slos.live.json');
    expect(existsSync(slosPath)).toBe(true);

    const content = readFileSync(slosPath, 'utf-8');
    const json = JSON.parse(content);

    // Should have performance metrics
    expect(json).toHaveProperty('engine_get_p95_ms');
    expect(typeof json.engine_get_p95_ms).toBe('number');
  });

  it.skipIf(!shouldRun)('report_v1.seed*.json exists and is valid', () => {
    const files = existsSync(evidenceDir) 
      ? require('fs').readdirSync(evidenceDir)
      : [];
    
    const reportFiles = files.filter((f: string) => f.startsWith('report_v1.seed') && f.endsWith('.json'));
    expect(reportFiles.length).toBeGreaterThan(0);

    // Validate first report file
    const reportPath = join(evidenceDir, reportFiles[0]);
    const content = readFileSync(reportPath, 'utf-8');
    const json = JSON.parse(content);

    // Should match run.v1 schema
    expect(json.schema).toBe('run.v1');
    expect(json).toHaveProperty('results');
    expect(json).toHaveProperty('model_card');
    expect(json.model_card).toHaveProperty('response_hash');
  });
});
