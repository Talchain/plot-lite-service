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

  // Run-level deadline test: overall maxDurationMs forces early timeout
  const plot = {
    id: 't-run-deadline',
    version: '1',
    steps: [
      { id: 'one', type: 'sleep', inputs: { ms: 50 } }
    ]
  };

  const { record } = await runPlot(plot, { maxDurationMs: 5 });
  const s = record.steps[0];
  assert.strictEqual(s.status, 'fail', 'final fail due to deadline');
  assert.strictEqual(s.reason, 'timeout', 'reason is timeout');
  // Attempt count can be 1 when the first run starts before the deadline expires and times out
  assert.ok(s.attempts >= 1, 'attempts >= 1 due to in-flight timeout');
};