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
    id: 't-run-deadline',
    version: '1',
    steps: [
      { id: 't', type: 'transform', inputs: { assign: { items: [1,2,3,4] } }, next: 'fo' },
      { id: 'fo', type: 'fanout', inputs: { fromPath: 'items', itemPath: 'item', concurrency: 2, steps: [ { type: 'sleep', inputs: { ms: 50 } } ] } }
    ]
  };

  const { record } = await runPlot(plot, { maxDurationMs: 30 });
  const fo = record.steps.find(s => s.id === 'fo');
  assert.ok(fo && fo.status === 'fail', 'fanout failed due to run-level deadline');
};
