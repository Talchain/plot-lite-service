const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const base = path.resolve(process.cwd(), 'docs');
  const out = path.resolve(process.cwd(), 'reports/docs-link-check.json');
  const result = { ok: true, skipped: false, filesScanned: 0, links: [], ts: new Date().toISOString() };
  if (!fs.existsSync(base)) {
    result.skipped = true;
    result.note = 'docs folder missing';
    return write(out, result);
  }
  const mdFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir)) {
      const p = path.join(dir, e);
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p); else if (p.endsWith('.md') || p.endsWith('.mdx')) mdFiles.push(p);
    }
  };
  walk(base);
  result.filesScanned = mdFiles.length;
  for (const f of mdFiles) {
    const txt = fs.readFileSync(f, 'utf8');
    const re = /\]\((https?:\/\/[^)]+)\)/g;
    let m;
    while ((m = re.exec(txt))) { result.links.push({ file: path.relative(process.cwd(), f), url: m[1] }); }
  }
  write(out, result);
})();
