const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const out = path.resolve(process.cwd(), 'reports/adr-lint.json');
  const base = path.resolve(process.cwd(), 'docs/adr');
  const result = { ok: true, skipped: false, findings: [], ts: new Date().toISOString() };
  if (!fs.existsSync(base)) {
    result.skipped = true;
    result.note = 'docs/adr folder missing';
    return write(out, result);
  }
  const files = fs.readdirSync(base).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const content = fs.readFileSync(path.join(base, f), 'utf8');
    if (!content.includes('#')) result.findings.push({ file: f, issue: 'missing-title' });
  }
  write(out, result);
})();
