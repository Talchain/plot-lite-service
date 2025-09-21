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
    const res = await fetch('http://localhost:4311/draft-flows', {
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
  } catch (e) {
    console.error('Failed to parse or validate OpenAPI spec:', e);
    process.exit(1);
  }
}

main();