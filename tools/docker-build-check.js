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
  const trivyOut = path.resolve(process.cwd(), 'reports/trivy.json');
  const buildOut = path.resolve(process.cwd(), 'reports/docker-build.json');
  const result = { ok: true, skipped: false, ts: new Date().toISOString(), docker: null };
  try {
    // Docker build check
    if (fs.existsSync(path.resolve(process.cwd(), 'Dockerfile'))) {
      const { code, out, err } = await run('docker', ['build', '-q', '.']);
      result.docker = { code, out: out.trim(), err: err.trim() };
      write(buildOut, result);
    } else {
      result.skipped = true;
      result.note = 'Dockerfile not found';
      write(buildOut, result);
    }
  } catch (e) {
    result.ok = false;
    result.error = e.message || String(e);
    write(buildOut, result);
  }
  try {
    const { code, out, err } = await run('npx', ['trivy', 'fs', '--format', 'json', '.']);
    if (code === 0 && out) {
      write(trivyOut, JSON.parse(out));
    } else {
      write(trivyOut, { ok: false, error: err || 'trivy failed' });
    }
  } catch (e) {
    write(trivyOut, { ok: false, error: e.message || String(e) });
  }
})();
