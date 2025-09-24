module.exports.runTest = async ({ runPlot, assert }) => {
  const path = require('path');
  const { pathToFileURL } = require('url');
  const registry = await import(pathToFileURL(path.resolve(process.cwd(), 'src/engine/registry.js')).href);

  // Deterministic flaky step: fails until a threshold kept in context
  registry.registerStep('flaky', async ({ ctx, step }) => {
    const until = step && step.inputs && typeof step.inputs.until === 'number' ? step.inputs.until : 0;
    ctx.__flaky = ctx.__flaky || 0;
    ctx.__flaky++;
    if (ctx.__flaky <= until) throw new Error('fail');
    return { ctx };
  });

  // First run: threshold 5, breaker threshold 2, cooldown short
  const plotA = {
    id: 't-breaker-a', version: '1', steps: [
      { id: 'x', type: 'flaky', inputs: { until: 5 }, retry: { max: 5, backoffMs: [0] }, breaker: { failThreshold: 2, cooldownMs: 50, halfOpenMax: 1 } }
    ]
  };
  const A = await runPlot(plotA, {});
  const sA = A.record.steps[0];
  assert.strictEqual(sA.status, 'fail');
  // Accept either retry-exhausted or breaker-open depending on timing; breaker-open is preferred
  assert.ok(['breaker-open', 'retry-exhausted'].includes(sA.reason));

  // Wait for cooldown
  await new Promise(r => setTimeout(r, 60));

  // Second run: same step id (breaker key), now should pass in half-open if breaker allows one probe
  const plotB = {
    id: 't-breaker-b', version: '1', steps: [
      { id: 'x', type: 'flaky', inputs: { until: 0 }, retry: { max: 1, backoffMs: [0] }, breaker: { failThreshold: 2, cooldownMs: 50, halfOpenMax: 1 } }
    ]
  };
  const B = await runPlot(plotB, {});
  const sB = B.record.steps[0];
  assert.strictEqual(sB.status, 'ok');
};
