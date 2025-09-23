module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = {
    id: 't-budget-stop',
    version: '1',
    steps: [
      { id: 's1', type: 'transform', inputs: { assign: { a: 1 } }, cost: { estimate: 0.6 }, next: 's2' },
      { id: 's2', type: 'transform', inputs: { assign: { b: 2 } }, cost: { estimate: 0.6 } }
    ]
  };
  const { record } = await runPlot(plot, { budget: { maxCost: 1 } });
  const s1 = record.steps[0];
  const s2 = record.steps[1];
  assert.strictEqual(s1.status, 'ok');
  assert.ok(s2, 'second step exists');
  assert.strictEqual(s2.status, 'fail');
  assert.strictEqual(s2.reason, 'budget-exceeded');
  assert.strictEqual(s2.attempts, 0);
};
