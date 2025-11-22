module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = { id: 't-calc-bad', version: '1', steps: [ { id: 'c1', type: 'calc', inputs: { assignTo: 'z', expr: 'a+unknown' } } ] };
  const { record } = await runPlot(plot, { input: { a: 1 } });
  assert.strictEqual(record.steps[0].status, 'fail');
};
