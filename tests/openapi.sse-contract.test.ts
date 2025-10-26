import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

describe('OpenAPI SSE contract', () => {
  it('sseRunEvent.event enum matches expected set', () => {
    const specPath = resolve(__dirname, '../contracts/openapi.yaml').replace(/tests\/$/, 'contracts/openapi.yaml');
    const raw = readFileSync(resolve(process.cwd(), 'contracts/openapi.yaml'), 'utf8');
    const doc: any = YAML.parse(raw);
    const enumVals: string[] = doc?.components?.schemas?.sseRunEvent?.properties?.event?.enum || [];
    expect(enumVals).toEqual([
      'RUN_STARTED',
      'PROGRESS',
      'INTERIM_FINDINGS',
      'HEARTBEAT',
      'COMPLETE',
      'ERROR',
    ]);
  });
});
