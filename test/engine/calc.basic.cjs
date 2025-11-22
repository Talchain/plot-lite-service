module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = { id: 't-calc-ok', version: '1', steps: [ { id: 'c1', type: 'calc', inputs: { assignTo: 'z', expr: '(a+b)*2' } } ] };
  const { record, ctx } = await runPlot(plot, { input: { a: 2, b: 3 } });
  assert.strictEqual(record.steps[0].status, 'ok');
  assert.strictEqual(ctx.z, 10);
};
