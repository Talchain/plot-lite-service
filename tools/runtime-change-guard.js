const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function write(file, obj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: true });
    let out = '';
    p.stdout.on('data', d => out += String(d));
    p.on('close', code => resolve({ code, out }));
  });
}

(async function main(){
  const out = path.resolve(process.cwd(), 'reports/runtime-change-guard.json');
  const baseSha = process.env.GITHUB_BASE_SHA || process.env.GITHUB_SHA || '';
  const range = baseSha ? `${baseSha}...HEAD` : 'HEAD~1..HEAD';
  const { out: diff } = await run('git', ['diff', '--name-only', range]);
  const changed = diff.split(/\r?\n/).filter(Boolean);
  const runtimeChanged = changed.filter(f => f.startsWith('src/'));
  const result = { ok: true, skipped: false, changedCount: changed.length, runtimeChanged, ts: new Date().toISOString() };
  write(out, result);
})();
