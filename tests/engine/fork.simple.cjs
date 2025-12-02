module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = {
    id: 't-fork-simple',
    version: '1',
    steps: [
      { id: 'start', type: 'transform', inputs: { assign: { score: 0.62 } }, next: 'decision' },
      { id: 'decision', type: 'gate', fork: { condition: '${score} >= 0.6', onTrue: 'endTrue', onFalse: 'endFalse' } },
      { id: 'endTrue', type: 'transform' },
      { id: 'endFalse', type: 'transform' }
    ]
  };
  const { record } = await runPlot(plot, {});
  const seen = record.steps.map(s => s.id);
  assert.ok(seen.includes('endTrue'));
  assert.ok(!seen.includes('endFalse'));
};
