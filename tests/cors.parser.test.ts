import { describe, it, expect } from 'vitest';

// Import directly from source; Vitest will transpile TS
import { parseCorsCsv } from '../src/lib/corsParser.ts';
import { withEnvSync } from './utils/withEnv.js';

describe('CORS CSV parser', () => {
  it('parses and normalises a single origin', () => {
    const out = parseCorsCsv('https://EXAMPLE.com');
    expect(out).toEqual(['https://example.com']);
  });

  it('parses multiple origins with spaces and ports', () => {
    const out = parseCorsCsv(' https://a.com , http://B.com:8080 ');
    expect(out.sort()).toEqual(['https://a.com', 'http://b.com:8080'].sort());
  });

  it('forbids wildcard by default', () => {
    expect(() => parseCorsCsv('*')).toThrow();
  });

  it('allows wildcard when CORS_DEV=1', () => {
    withEnvSync({ CORS_DEV: '1' }, () => {
      const out = parseCorsCsv('*');
      expect(out).toEqual(['*']);
    });
  });
});
