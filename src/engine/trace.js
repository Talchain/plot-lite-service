import fs from 'node:fs';
import path from 'node:path';

let tracerInstance = null;

function mkFile() {
  const root = process.cwd();
  const dir = path.join(root, 'reports', 'warp', 'traces');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `trace-${ts}.jsonl`);
}

export function getTracer() {
  const enabled = String(process.env.ENGINE_TRACE || '').toLowerCase();
  const isOn = enabled === '1' || enabled === 'true' || enabled === 'yes';
  if (!isOn) return { emit() {} };
  if (tracerInstance) return tracerInstance;
  const file = mkFile();
  tracerInstance = {
    emit(obj) {
      try {
        const rec = { ts: new Date().toISOString(), ...obj };
        fs.appendFileSync(file, JSON.stringify(rec) + '\n');
      } catch {}
    }
  };
  return tracerInstance;
}