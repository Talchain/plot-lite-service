module.exports.runTest = async ({ runPlot, assert }) => {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const registry = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);

  // Register a sleep step for this test only
  registry.registerStep('sleep', async ({ step }) => {
    const ms = step && step.inputs && typeof step.inputs.ms === 'number' ? step.inputs.ms : 0;
    await new Promise(r => setTimeout(r, ms));
    return {};
  });

  const plot = {
    id: 't-timeout-cap',
    version: '1',
    steps: [
      { id: 'one', type: 'sleep', timeoutMs: 5, inputs: { ms: 20 } }
    ]
  };

  const { record } = await runPlot(plot, {});
  const s = record.steps[0];
  assert.strictEqual(s.status, 'fail', 'final fail');
  assert.strictEqual(s.reason, 'timeout', 'reason is timeout');
};
