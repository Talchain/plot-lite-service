module.exports.runTest = async ({ assert }) => {
  const { backoffNext } = require('../../src/engine/backoff.js');
  // fixed strategy deterministic
  const d1 = backoffNext({ strategy: 'fixed', baseMs: 100, jitter: false, attempt: 1, seedParts: ['a', 'b', 1] });
  const d2 = backoffNext({ strategy: 'fixed', baseMs: 100, jitter: false, attempt: 2, seedParts: ['a', 'b', 2] });
  assert.strictEqual(d1, 100);
  assert.strictEqual(d2, 100);
  // exponential strategy grows
  const e1 = backoffNext({ strategy: 'exponential', baseMs: 50, maxMs: 400, jitter: false, attempt: 1, seedParts: ['x'] });
  const e3 = backoffNext({ strategy: 'exponential', baseMs: 50, maxMs: 400, jitter: false, attempt: 3, seedParts: ['x'] });
  assert.strictEqual(e1, 50);
  assert.strictEqual(e3, 200);
  // jitter deterministic in [0, base)
  const j1 = backoffNext({ strategy: 'fixed', baseMs: 100, jitter: 'full', attempt: 1, seedParts: ['seed', 1] });
  const j2 = backoffNext({ strategy: 'fixed', baseMs: 100, jitter: 'full', attempt: 1, seedParts: ['seed', 1] });
  assert.strictEqual(j1, j2);
};
