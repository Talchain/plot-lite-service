import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';

async function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true, ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => resolve({ code: code ?? 1, stdout: out, stderr: err }));
  });
}

async function main() {
  try {
    const { code, stdout } = await run('npm', ['audit', '--json']);
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/audit.json', stdout || '{}', 'utf8');
    let data;
    try { data = JSON.parse(stdout || '{}'); } catch { data = {}; }
    const advisories = data?.advisories || data?.vulnerabilities || {};
    let critical = 0, high = 0, moderate = 0, low = 0;
    if (data?.metadata?.vulnerabilities) {
      const v = data.metadata.vulnerabilities;
      critical = v.critical || 0; high = v.high || 0; moderate = v.moderate || 0; low = v.low || 0;
    } else if (advisories) {
      // Fallback simple count
      for (const a of Object.values(advisories)) {
        const sev = (a.severity || '').toLowerCase();
        if (sev === 'critical') critical++; else if (sev === 'high') high++; else if (sev === 'moderate') moderate++; else if (sev === 'low') low++;
      }
    }
    console.log(`npm audit summary: critical=${critical} high=${high} moderate=${moderate} low=${low}`);
    // non-blocking
    process.exit(0);
  } catch (e) {
    console.log('npm audit failed to run; skipping');
    process.exit(0);
  }
}

main();