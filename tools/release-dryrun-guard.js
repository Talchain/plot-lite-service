const fs = require('fs');
const path = require('path');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

(function main(){
  const out = path.resolve(process.cwd(), 'reports/release-dryrun.json');
  const ref = process.env.GITHUB_REF || '';
  const isTag = ref.startsWith('refs/tags/');
  const result = { ok: true, skipped: false, isTag, ref, note: '', ts: new Date().toISOString() };
  if (!isTag) {
    result.skipped = true;
    result.note = 'not a tag CI run';
  }
  write(out, result);
})();
