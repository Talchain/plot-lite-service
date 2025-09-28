module.exports.runTest = async ({ runPlot, assert }) => {
  const cases = [
    { name: 'assign not object', inputs: { assign: 1 } },
    { name: 'assign array', inputs: { assign: [] } },
  ];
  for (const c of cases) {
    const plot = { id: 't-transform-bad-' + c.name, version: '1', steps: [ { id: 't1', type: 'transform', inputs: c.inputs } ] };
    const { record } = await runPlot(plot, { input: {} });
    assert.strictEqual(record.steps[0].status, 'fail');
    assert.ok(String(record.steps[0].reason || '').includes('BAD_INPUT'));
  }
};
