module.exports.runTest = async ({ assert }) => {
  const fs = require('fs');
  const path = require('path');
  const p = path.resolve(process.cwd(), 'reports', 'tests.json');
  assert.ok(fs.existsSync(p), 'tests.json exists');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(j && j.summary && typeof j.summary.total === 'number');
  assert.ok(typeof j.summary.ok === 'number');
  assert.ok(typeof j.summary.failed === 'number');
  assert.ok(typeof j.summary.timestamp === 'string');
  // durationMs is optional but if present must be number
  if (j.summary.durationMs !== undefined) assert.ok(typeof j.summary.durationMs === 'number');
};
