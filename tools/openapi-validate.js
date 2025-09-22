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
  const openapi = 'openapi/openapi-plot-lite-v1.yaml';
  const outFile = path.resolve(process.cwd(), 'reports/openapi-validate.json');
  if (!fs.existsSync(openapi)) {
    return write(outFile, { ok: true, skipped: true, note: `${openapi} missing`, ts: new Date().toISOString() });
  }
  try {
    const { code, out, err } = await run('npx', ['swagger-parser', 'validate', openapi]);
    const ok = code === 0;
    write(outFile, { ok, output: out.trim(), error: ok ? undefined : (err || 'failed'), ts: new Date().toISOString() });
  } catch (e) {
    write(outFile, { ok: false, error: e.message || String(e), ts: new Date().toISOString() });
  }
})();
