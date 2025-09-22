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
  const outFile = path.resolve(process.cwd(), 'reports/sbom.json');
  let result = { ok: true, skipped: false, tool: 'cyclonedx-npm', ts: new Date().toISOString() };
  try {
    const { code, err } = await run('npx', ['@cyclonedx/cyclonedx-npm', '--output-format', 'json', '--output-file', outFile]);
    if (code !== 0) {
      result.ok = false;
      result.error = err || 'cyclonedx failed';
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message || String(e);
  }
  if (!fs.existsSync(outFile)) {
    result.skipped = true;
    write(outFile, result);
  }
})();
