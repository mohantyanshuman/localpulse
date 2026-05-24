const test = require('node:test');
const assert = require('node:assert');
const { cellKey, memo, _reset } = require('../../services/eo/cache');

test('cellKey rounds to ~0.1 degree so nearby points share a cell', () => {
  assert.strictEqual(cellKey(30.912, 77.061), cellKey(30.949, 77.099));
  assert.notStrictEqual(cellKey(30.91, 77.06), cellKey(31.21, 77.06));
});

test('memo caches within ttl and recomputes after expiry', async () => {
  _reset();
  let calls = 0;
  const fn = async () => { calls += 1; return calls; };
  const a = await memo('k', 1000, fn);
  const b = await memo('k', 1000, fn);
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1); // served from cache
  const c = await memo('k', 0, fn); // ttl 0 forces recompute
  assert.strictEqual(c, 2);
});
