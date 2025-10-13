#!/usr/bin/env node
/**
 * openapi-render.mjs
 * Renders contracts/openapi.yaml → artifact/openapi.json (2-space)
 * - Ensures artifact/ exists
 * - Writes to a temp file then renames atomically
 * - Exits non-zero on failure with a clear reason
 */
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

function fail(msg) {
  console.log(String(msg));
  process.exit(1);
}

try {
  const yaml = await import('yaml');
  const specPath = resolve(process.cwd(), 'contracts', 'openapi.yaml');
  const outPath = resolve(process.cwd(), 'artifact', 'openapi.json');
  const outDir = dirname(outPath);
  try { mkdirSync(outDir, { recursive: true }); } catch {}
  let obj;
  try {
    const ytxt = readFileSync(specPath, 'utf8');
    obj = yaml.parse(ytxt);
  } catch (e) {
    fail(`GATES: FAIL — openapi render parse error: ${e?.message || e}`);
  }
  const tmp = outPath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    renameSync(tmp, outPath);
  } catch (e) {
    fail(`GATES: FAIL — openapi render write error: ${e?.message || e}`);
  }
  // No GATES line here (script used standalone or by gate)
  process.exit(0);
} catch (e) {
  fail(`GATES: FAIL — openapi render setup error: ${e?.message || e}`);
}
