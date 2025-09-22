const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const out = path.resolve(process.cwd(), 'reports/engines-check.json');
  if (!fs.existsSync(pkgPath)) return write(out, { ok: true, skipped: true, note: 'package.json missing' });
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const engines = pkg.engines || {};
    const nodeSpec = engines.node || null;
    write(out, { ok: true, skipped: false, engines, nodeSpec, ts: new Date().toISOString() });
  } catch (e) {
    write(out, { ok: false, error: e.message || String(e), ts: new Date().toISOString() });
  }
})();
