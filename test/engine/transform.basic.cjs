module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = {
    id: 't-transform-basic',
    version: '1',
    steps: [
      { id: 's1', type: 'transform', inputs: { assign: { greeting: 'Hello' } }, next: 's2' },
      { id: 's2', type: 'gate', inputs: { path: 'greeting', op: '===', value: 'Hello' } }
    ]
  };
  const { record, ctx } = await runPlot(plot, {});
  assert.strictEqual(ctx.greeting, 'Hello');
  assert.ok(Array.isArray(record.steps) && record.steps.length >= 1);
  const failures = record.steps.filter(s => s.status !== 'ok');
  assert.strictEqual(failures.length, 0);
};
