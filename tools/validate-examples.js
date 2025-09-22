const fs = require('fs');
const path = require('path');

function writeJson(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function loadExamples(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => ({ name: f, path: path.join(dir, f) }));
}

function main() {
  const out = path.resolve(process.cwd(), 'reports/examples-validation.json');
  const base = path.resolve(process.cwd(), 'fixtures/examples');
  const items = loadExamples(base);
  const result = { ok: true, skipped: false, count: items.length, findings: [], ts: new Date().toISOString() };
  for (const it of items) {
    try {
      const data = JSON.parse(fs.readFileSync(it.path, 'utf8'));
      if (data == null || typeof data !== 'object') {
        result.findings.push({ file: it.name, error: 'not-an-object' });
        result.ok = false;
      }
    } catch (e) {
      result.findings.push({ file: it.name, error: 'json-parse-failed', message: e.message });
      result.ok = false;
    }
  }
  if (items.length === 0) {
    result.skipped = true;
    result.note = 'No examples found under fixtures/examples';
  }
  writeJson(out, result);
}

main();
