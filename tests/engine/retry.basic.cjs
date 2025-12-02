module.exports.runTest = async ({ runPlot, assert }) => {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const registry = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);

  // Register a deterministic unstable step for this test only
  registry.registerStep('unstable', async ({ ctx, step }) => {
    const until = step && step.inputs && typeof step.inputs.until === 'number' ? step.inputs.until : 0;
    ctx.__unstable = ctx.__unstable || {};
    const k = step.id || 'one';
    const n = (ctx.__unstable[k] || 0) + 1;
    ctx.__unstable[k] = n;
    if (n <= until) throw new Error('fail-until');
    return { ctx };
  });

  const plot = {
    id: 't-retry-basic',
    version: '1',
    steps: [
      { id: 'one', type: 'unstable', retry: { max: 3, backoffMs: [0] }, inputs: { until: 2 } }
    ]
  };

  const { record, stats } = await runPlot(plot, {});
  assert.ok(Array.isArray(record.steps) && record.steps.length === 1, 'one step recorded');
  const s = record.steps[0];
  assert.strictEqual(s.status, 'ok', 'final ok');
  assert.strictEqual(s.attempts, 3, 'attempts==3');
  assert.ok(stats.retries >= 2, 'stats.retries >= 2');
};
