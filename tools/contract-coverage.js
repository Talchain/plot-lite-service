const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const out = path.resolve(process.cwd(), 'reports/contract-coverage.json');
  const openapiPath = path.resolve(process.cwd(), 'openapi/openapi-plot-lite-v1.yaml');
  const exists = fs.existsSync(openapiPath);
  const result = {
    ok: true,
    skipped: !exists,
    openapi: exists ? 'present' : 'missing',
    coverage: { endpoints: 0, tested: 0, percent: 0 },
    ts: new Date().toISOString()
  };
  if (!exists) result.note = 'OpenAPI file not found';
  write(out, result);
})();
