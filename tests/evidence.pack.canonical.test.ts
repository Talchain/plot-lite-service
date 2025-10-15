import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('Evidence Pack canonical structure', () => {
  const evidenceDir = join(process.cwd(), 'artifact', 'pack', 'evidence');

  // Skip if evidence pack hasn't been built (run npm run evidence:generate first)
  const shouldRun = existsSync(evidenceDir);

  it.skipIf(!shouldRun)('evidence/ directory exists', () => {
    expect(existsSync(evidenceDir)).toBe(true);
  });

  it.skipIf(!shouldRun)('pack-meta.json exists and is valid JSON', () => {
    const metaPath = join(evidenceDir, 'pack-meta.json');
    expect(existsSync(metaPath)).toBe(true);

    const content = readFileSync(metaPath, 'utf-8');
    const json = JSON.parse(content);

    // Required fields
    expect(json).toHaveProperty('schema');
    expect(json.schema).toBe('pack-meta.v1');
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

    // Should have schema and source
    expect(json).toHaveProperty('schema');
    expect(json).toHaveProperty('source');
    expect(json).toHaveProperty('engine_get_p95_ms');
    expect(typeof json.engine_get_p95_ms).toBe('number');
  });

  it.skipIf(!shouldRun)('report_v1.seed*.json exists if generated', () => {
    if (!existsSync(evidenceDir)) return;
    
    const files = readdirSync(evidenceDir);
    const reportFiles = files.filter((f: string) => f.startsWith('report_v1.seed') && f.endsWith('.json'));
    
    // Report file is optional (only generated if fixture exists)
    if (reportFiles.length === 0) {
      console.log('ℹ️  No report files found (expected if golden fixture not available)');
      return;
    }

    // If report exists, validate it
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
