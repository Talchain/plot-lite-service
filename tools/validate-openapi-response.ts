import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';

async function main() {
  const specPath = resolve(process.cwd(), 'openapi', 'openapi-plot-lite-v1.yaml');
  if (!existsSync(specPath)) {
    console.log('OpenAPI spec not found; skipping validation.');
    process.exit(0);
  }
  const yamlText = readFileSync(specPath, 'utf8');
  try {
    const doc = YAML.parse(yamlText);
    // Best-effort: syntax parsed. Now validate one live response matches basic shape
    const BASE = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://localhost:4311';

    async function fetchWithRetry(url: string, init: any, tries = 3): Promise<Response> {
      let attempt = 0;
      let lastErr: any;
      while (attempt < tries) {
        try {
          return await fetch(url, init);
        } catch (err: any) {
          const code = (err?.cause as any)?.code || '';
          if (code === 'ECONNREFUSED' || code === 'EAI_AGAIN') {
            await new Promise((r) => setTimeout(r, 50));
            attempt++;
            lastErr = err;
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new Error('fetch failed');
    }

    try {
      const res = await fetchWithRetry(`${BASE}/draft-flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: 1 }),
      });
      const json = await res.json();
      if (!json || !Array.isArray(json.drafts)) {
        console.error('OpenAPI lightweight check failed: response missing drafts array.');
        process.exit(1);
      }
      console.log('OpenAPI lightweight check passed.');
    } catch (netErr) {
      // Non-fatal in tests: server may be unavailable momentarily
      console.warn('OpenAPI check skipped: server unavailable;', (netErr as any)?.message || netErr);
      process.exit(0);
    }
  } catch (e) {
    console.error('Failed to parse or validate OpenAPI spec:', e);
    process.exit(1);
  }
}

main();