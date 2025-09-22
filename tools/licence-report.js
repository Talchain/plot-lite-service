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
    let out = '', err = '';
    p.stdout.on('data', d => out += String(d));
    p.stderr.on('data', d => err += String(d));
    p.on('close', code => resolve({ code, out, err }));
  });
}

(async function main(){
  const outFile = path.resolve(process.cwd(), 'reports/licences.json');
  let summary = { ok: true, skipped: false, tool: 'license-checker', ts: new Date().toISOString() };
  try {
    const { code, out, err } = await run('npx', ['license-checker', '--json']);
    if (code === 0 && out) {
      write(outFile, { ok: true, dependencies: JSON.parse(out) });
      return;
    }
    summary.ok = false;
    summary.error = err || 'license-checker failed';
  } catch (e) {
    summary.ok = false;
    summary.error = e.message || String(e);
  }
  write(outFile, summary);
})();
