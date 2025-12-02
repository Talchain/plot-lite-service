module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = { id: 't-map-assign', version: '1', steps: [ { id: 'm2', type: 'map', inputs: { fromPath: 'tier', mapping: { pro: 1 }, default: 0, assignTo: 'score.tier' } } ] };
  const { record, ctx } = await runPlot(plot, { input: { tier: 'free' } });
  assert.strictEqual(record.steps[0].status, 'ok');
  assert.strictEqual(ctx.score.tier, 0);
};
