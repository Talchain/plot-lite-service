#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

function fail(msg) {
  console.error('manifest-validate:', msg);
  process.exit(1);
}

try {
  const manifestPath = process.argv[2] ? resolve(process.argv[2]) : null;
  if (!manifestPath) fail('usage: node tools/manifest-validate.mjs <manifest.json>');
  const schemaPath = resolve('contracts/pack-manifest.schema.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) fail('invalid: ' + JSON.stringify(validate.errors));
  console.log('manifest-validate: OK');
  process.exit(0);
} catch (e) {
  fail(e?.message || String(e));
}
