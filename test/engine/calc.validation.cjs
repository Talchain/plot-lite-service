module.exports.runTest = async ({ runPlot, assert }) => {
  const cases = [
    { name: 'missing assignTo', inputs: { expr: '1+2' } },
    { name: 'missing expr', inputs: { assignTo: 'z' } },
    { name: 'vars not object', inputs: { assignTo: 'z', expr: 'a+b', vars: 1 } },
  ];
  for (const c of cases) {
    const plot = { id: 't-calc-bad-' + c.name, version: '1', steps: [ { id: 'c1', type: 'calc', inputs: c.inputs } ] };
    const { record } = await runPlot(plot, { input: { a: 1, b: 2 } });
    assert.strictEqual(record.steps[0].status, 'fail');
    assert.ok(String(record.steps[0].reason || '').includes('BAD_INPUT'));
  }
};
