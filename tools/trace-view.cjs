#!/usr/bin/env node
// tools/trace-view.cjs
// Simple JSONL trace filter. Usage:
//   node tools/trace-view.cjs <file> [--event=step-fail] [--id=<stepId>] [--contains=substr]
const fs = require('node:fs');

function parseArgs(argv){
  const out = { file: null, event: null, id: null, contains: null };
  for (const a of argv.slice(2)){
    if (!out.file && !a.startsWith('--')) { out.file = a; continue; }
    if (a.startsWith('--event=')) out.event = a.split('=')[1]||'';
    else if (a.startsWith('--id=')) out.id = a.split('=')[1]||'';
    else if (a.startsWith('--contains=')) out.contains = a.split('=')[1]||'';
  }
  return out;
}

function main(){
  const { file, event, id, contains } = parseArgs(process.argv);
  if (!file || !fs.existsSync(file)){
    console.error('Usage: node tools/trace-view.cjs <file> [--event=step-fail] [--id=ID] [--contains=substr]');
    process.exit(1);
  }
  const rl = require('readline').createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  rl.on('line', (line) => {
    try {
      const o = JSON.parse(line);
      if (event && String(o.ev) !== event) return;
      if (id && String(o.id||'') !== id) return;
      if (contains && !line.includes(contains)) return;
      console.log(line);
    } catch {}
  });
}

main();
