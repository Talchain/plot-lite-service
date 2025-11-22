module.exports.runTest = async ({ runPlot, assert }) => {
  const plot = {
    id: 't-ratelimit-simple',
    version: '1',
    steps: [
      { id: 's1', type: 'transform', inputs: { assign: { x: 1 } }, rateLimit: { key: 'k1', limit: 1, intervalMs: 1000 }, next: 's2' },
      // No retries (max=0) so second step should fail with reason "rate-limit" if within same window
      { id: 's2', type: 'transform', inputs: { assign: { y: 2 } }, rateLimit: { key: 'k1', limit: 1, intervalMs: 1000 }, retry: { max: 0 } }
    ]
  };
  const { record, stats } = await runPlot(plot, {});
  const s1 = record.steps[0];
  const s2 = record.steps[1];
  // Either it retried (stats.retries > 0) or it failed with rate-limit (when max=0, no retry)
  assert.strictEqual(s1.status, 'ok');
  assert.ok((stats.retries > 0) || (s2 && s2.status === 'fail' && s2.reason === 'rate-limit'));
};
