module.exports.runTest = async ({ runPlot, assert }) => {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const registry = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);

  // Sleep step for timing control
  registry.registerStep('sleep', async ({ step }) => {
    const ms = step && step.inputs && typeof step.inputs.ms === 'number' ? step.inputs.ms : 0;
    await new Promise(r => setTimeout(r, ms));
    return {};
  });

  // A step that may fail based on ctx.item value
  registry.registerStep('maybeFail', async ({ ctx }) => {
    if (ctx && ctx.item === 'boom') throw new Error('boom');
    return { ctx };
  });

  // Prepare initial context via transform
  const setItems = { id: 'set', type: 'transform', inputs: { assign: { items: ['a','b','c','d'] } } };

  // Serial fanout over 4 items with 20ms each
  const serial = {
    id: 't-fanout-serial',
    version: '1',
    steps: [
      { ...setItems, next: 'fo' },
      { id: 'fo', type: 'fanout', inputs: { fromPath: 'items', itemPath: 'item', concurrency: 1, steps: [ { type: 'sleep', inputs: { ms: 20 } } ] } }
    ]
  };
  const t0 = Date.now();
  let res = await runPlot(serial, {});
  const serialMs = Date.now() - t0;
  assert.strictEqual(res.record.steps[1].status, 'ok', 'fanout serial ok');
  assert.ok(serialMs >= 60, 'serial took at least ~60ms');

  // Parallel fanout with concurrency 2 should be faster than serial (tolerant bound)
  const parallel = {
    id: 't-fanout-parallel',
    version: '1',
    steps: [
      { ...setItems, next: 'fo' },
      { id: 'fo', type: 'fanout', inputs: { fromPath: 'items', itemPath: 'item', concurrency: 2, steps: [ { type: 'sleep', inputs: { ms: 20 } } ] } }
    ]
  };
  const p0 = Date.now();
  res = await runPlot(parallel, {});
  const parallelMs = Date.now() - p0;
  assert.strictEqual(res.record.steps[1].status, 'ok', 'fanout parallel ok');
  assert.ok(parallelMs <= serialMs, 'parallel not slower than serial');

  // Fail-fast: one item fails, should cause step to fail
  const withFail = {
    id: 't-fanout-failfast',
    version: '1',
    steps: [
      { id: 'setX', type: 'transform', inputs: { assign: { items: ['ok','boom','ok','ok'] } }, next: 'fo' },
      { id: 'fo', type: 'fanout', inputs: { fromPath: 'items', itemPath: 'item', concurrency: 2, stopOnFirstError: true, steps: [ { type: 'maybeFail' } ] } }
    ]
  };
  res = await runPlot(withFail, {});
  const fo = res.record.steps.find(s => s.id === 'fo');
  assert.ok(fo && fo.status === 'fail', 'fanout marked as fail');
};