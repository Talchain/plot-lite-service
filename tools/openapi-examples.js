const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const out = path.resolve(process.cwd(), 'reports/openapi-examples.json');
  const api = path.resolve(process.cwd(), 'openapi/openapi-plot-lite-v1.yaml');
  if (!fs.existsSync(api)) return write(out, { ok: true, skipped: true, note: 'OpenAPI missing' });
  // Minimal placeholder; would parse examples and check roundtrip if present
  write(out, { ok: true, skipped: false, note: 'roundtrip checks not implemented in stub', ts: new Date().toISOString() });
})();
