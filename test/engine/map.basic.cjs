module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = { id: 't-map-basic', version: '1', steps: [ { id: 'm1', type: 'map', inputs: { fromPath: 'color', mapping: { gold: 'GOLD' }, default: 'UNK' } } ] };
  const { record, ctx } = await runPlot(plot, { input: { color: 'gold' } });
  assert.strictEqual(record.steps[0].status, 'ok');
  assert.strictEqual(ctx.color, 'GOLD');
};
