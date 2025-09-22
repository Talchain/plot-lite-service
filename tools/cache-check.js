const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function writeJson(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += String(d));
    p.stderr.on('data', d => err += String(d));
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

(async function main(){
  const outFile = path.resolve(process.cwd(), 'reports/cache-check.json');
  const result = { ok: true, skipped: false, node: process.version, npmCache: null, notes: [], ts: new Date().toISOString() };
  try {
    const pkgLock = fs.existsSync(path.resolve(process.cwd(), 'package-lock.json'));
    if (!pkgLock) {
      result.skipped = true;
      result.notes.push('package-lock.json missing');
    } else {
      const { code, out } = await run('npm', ['config', 'get', 'cache']);
      result.npmCache = { code, path: out };
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message || String(e);
  }
  writeJson(outFile, result);
})();
