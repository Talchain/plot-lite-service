const fs = require('fs');
const path = require('path');
const OUT_DIR = path.join(process.cwd(), 'reports');
const OUT_FILE = path.join(OUT_DIR, 'plot-validate.json');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return { __error__: `read/parse error: ${e.message}` }; }
}

function validatePlotShape(plot) {
  const errors = [];
  if (!plot || typeof plot !== 'object') { errors.push('plot must be an object'); return errors; }
  if (!plot.id || typeof plot.id !== 'string') errors.push('plot.id required string');
  if (!Array.isArray(plot.steps) || plot.steps.length < 1) errors.push('plot.steps must be non-empty array');
  if (Array.isArray(plot.steps)) {
    const ids = new Set();
    for (const [i, s] of plot.steps.entries()) {
      if (!s || typeof s !== 'object') { errors.push(`steps[${i}] must be object`); continue; }
      if (!s.id || typeof s.id !== 'string') errors.push(`steps[${i}].id required string`);
      if (s.id && ids.has(s.id)) errors.push(`steps[${i}].id duplicate: ${s.id}`); else if (s.id) ids.add(s.id);
      if (!s.type || !['transform','http','llm','gate'].includes(s.type)) errors.push(`steps[${i}].type invalid`);
      if (s.timeoutMs !== undefined && !(Number.isInteger(s.timeoutMs) && s.timeoutMs > 0)) errors.push(`steps[${i}].timeoutMs must be positive int`);
      if (s.retries !== undefined && !(Number.isInteger(s.retries) && s.retries >= 0)) errors.push(`steps[${i}].retries must be int >= 0`);
      if (s.fork) {
        if (typeof s.fork !== 'object') errors.push(`steps[${i}].fork must be object`);
        else if (!s.fork.condition || typeof s.fork.condition !== 'string') errors.push(`steps[${i}].fork.condition required string`);
      }
    }
  }
  return errors;
}

function main() {
  const fixturesDir = path.join(process.cwd(), 'fixtures', 'plots');
  const files = fs.existsSync(fixturesDir) ? fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json')) : [];
  const results = [];
  for (const f of files) {
    const full = path.join(fixturesDir, f);
    const data = readJSON(full);
    let ok = true, errors = [];
    if (data.__error__) { ok = false; errors = [data.__error__]; }
    else {
      errors = validatePlotShape(data);
      ok = errors.length === 0;
    }
    results.push({ file: `fixtures/plots/${f}`, ok, errors });
  }
  const summary = {
    total: results.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    timestamp: new Date().toISOString()
  };
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ summary, results }, null, 2));
  console.log(`Wrote ${OUT_FILE}`);
}
main();
