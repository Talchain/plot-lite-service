const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const out = path.resolve(process.cwd(), 'reports/seed-corpus.json');
  // Produce a tiny deterministic corpus of seeds for tests/tools to consume
  const seeds = [1, 42, 123, 333, 444, 999, 12345];
  write(out, { ok: true, seeds, count: seeds.length, ts: new Date().toISOString() });
})();
