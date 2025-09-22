const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const inFile = path.resolve(process.cwd(), 'reports/tests.json');
  const out = path.resolve(process.cwd(), 'reports/slow-tests.json');
  if (!fs.existsSync(inFile)) {
    return write(out, { ok: true, skipped: true, note: 'tests.json missing', ts: new Date().toISOString() });
  }
  try {
    const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
    const tests = Array.isArray(data.tests) ? data.tests : [];
    const slow = tests.filter(t => typeof t.duration === 'number' && t.duration >= 500).map(t => ({ name: t.name, duration: t.duration }));
    write(out, { ok: true, skipped: false, count: slow.length, slow, ts: new Date().toISOString() });
  } catch (e) {
    write(out, { ok: false, error: e.message || String(e), ts: new Date().toISOString() });
  }
})();
