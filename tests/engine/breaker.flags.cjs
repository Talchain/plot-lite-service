const fs = require('fs');
const path = require('path');
const cp = require('child_process');
module.exports.runTest = async ({ runPlot, assert }) => {
  const out = path.resolve(process.cwd(), 'reports', 'runs', 'demo-breaker.json');
  try { cp.execFileSync(process.execPath, ['tools/plot-run.cjs', 'docs/plot-lite-engine/fixtures/safety-nets-demo.json', '--seed=42', '--consecFailLimit=2', '--report='+out], { stdio: 'pipe' }); } catch (e) { assert.ok(false, 'plot-run failed: '+(e.stderr||e.stdout||e.message)); }
  assert.ok(fs.existsSync(out), 'report not written');
};
