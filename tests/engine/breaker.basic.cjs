module.exports.runTest = async ({ assert }) => {
  const { getBreaker } = require('../../src/engine/breaker.js');
  const br = getBreaker('t', { failThreshold: 2, cooldownMs: 50, halfOpenMax: 1 });
  // initially closed, can pass
  assert.ok(br.canPass(), 'closed allows');
  // two failures trip to open
  br.onFailure('error');
  br.onFailure('error');
  assert.ok(!br.canPass(), 'open blocks');
  // after cooldown, half-open and one probe allowed
  await new Promise(r => setTimeout(r, 60));
  assert.ok(br.canPass(), 'half-open allows one');
  // success closes
  br.onSuccess();
  assert.ok(br.canPass(), 'closed after success');
};
