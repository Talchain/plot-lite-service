#!/usr/bin/env node
// tools/trace-view.cjs
// Simple JSONL trace filter. Usage:
//   node tools/trace-view.cjs <file> [--event=step-fail] [--id=<stepId>] [--contains=substr] [--only=fail|retry|slow] [--help]
const fs = require('node:fs');

function parseArgs(argv){
  const out = { file: null, event: null, id: null, contains: null, only: null, help: false };
  for (const a of argv.slice(2)){
    if (!out.file && !a.startsWith('--')) { out.file = a; continue; }
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--event=')) out.event = a.split('=')[1]||'';
    else if (a.startsWith('--id=')) out.id = a.split('=')[1]||'';
    else if (a.startsWith('--contains=')) out.contains = a.split('=')[1]||'';
    else if (a.startsWith('--only=')) out.only = a.split('=')[1]||'';
  }
  return out;
}

function main(){
  const { file, event, id, contains, only, help } = parseArgs(process.argv);
  const usage = 'Usage: node tools/trace-view.cjs <file> [--event=step-fail] [--id=ID] [--contains=substr] [--only=fail|retry|slow]';
  if (help){
    console.log(usage);
    process.exit(0);
  }
  if (!file || !fs.existsSync(file)){
    console.error(usage);
    process.exit(1);
  }
  const rl = require('readline').createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const slowMs = Math.max(1, Number(process.env.TRC_SLOW_MS || 200) || 200);
  rl.on('line', (line) => {
    try {
      const o = JSON.parse(line);
      if (event && String(o.ev) !== event) return;
      if (only) {
        if (only === 'fail' && String(o.ev) !== 'step-fail') return;
        if (only === 'retry' && String(o.ev) !== 'retry') return;
        if (only === 'slow' && !(String(o.ev) === 'step-ok' && Number(o.ms || 0) >= slowMs)) return;
      }
      if (id && String(o.id||'') !== id) return;
      if (contains && !line.includes(contains)) return;
      // Pretty compact output: timestamp, ev, id, ms/attempts/reason if present
      const parts = [o.ts, o.ev, (o.id||'')].filter(Boolean);
      if (o.ms != null) parts.push(`${o.ms}ms`);
      if (o.attempts != null) parts.push(`attempts=${o.attempts}`);
      if (o.reason) parts.push(`reason=${o.reason}`);
      console.log(parts.join(' \u2022 '));
    } catch {}
  });
}

main();
