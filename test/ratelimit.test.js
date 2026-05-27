'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { createLimiter, rateLimit, clientIp } = require('../services/ratelimit');

test('token bucket allows up to capacity then rejects', () => {
  const lim = createLimiter({ capacity: 3, refillPerSec: 0 });
  assert.ok(lim.take('a').ok);
  assert.ok(lim.take('a').ok);
  assert.ok(lim.take('a').ok);
  const r = lim.take('a');
  assert.strictEqual(r.ok, false);
  assert.ok(r.retryAfter >= 1);
});

test('buckets are per-key (per IP)', () => {
  const lim = createLimiter({ capacity: 1, refillPerSec: 0 });
  assert.ok(lim.take('ip1').ok);
  assert.strictEqual(lim.take('ip1').ok, false);
  assert.ok(lim.take('ip2').ok, 'a different IP has its own bucket');
});

test('refill restores tokens over time', () => {
  const lim = createLimiter({ capacity: 1, refillPerSec: 1000 }); // ~instant refill
  assert.ok(lim.take('x').ok);
  // after a tiny delay the bucket should have refilled; emulate by spinning briefly
  const start = Date.now();
  while (Date.now() - start < 5) { /* ~5ms */ }
  assert.ok(lim.take('x').ok);
});

test('clientIp prefers CF-Connecting-IP, then first X-Forwarded-For hop, then req.ip', () => {
  assert.strictEqual(clientIp({ headers: { 'cf-connecting-ip': '1.2.3.4' } }), '1.2.3.4');
  assert.strictEqual(clientIp({ headers: { 'x-forwarded-for': '5.6.7.8, 9.9.9.9' } }), '5.6.7.8');
  assert.strictEqual(clientIp({ headers: {}, ip: '2.2.2.2' }), '2.2.2.2');
});

test('rateLimit middleware 429s after capacity with Retry-After', () => {
  const mw = rateLimit({ capacity: 2, refillPerSec: 0, code: 'test_limit' });
  const mkReq = () => ({ headers: { 'cf-connecting-ip': '7.7.7.7' } });
  function mkRes() { return { headers: {}, code: 200, body: null, set(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } }; }
  let nexts = 0; const next = () => { nexts += 1; };
  mw(mkReq(), mkRes(), next);
  mw(mkReq(), mkRes(), next);
  assert.strictEqual(nexts, 2);
  const res = mkRes();
  mw(mkReq(), res, next);
  assert.strictEqual(nexts, 2, 'third request blocked');
  assert.strictEqual(res.code, 429);
  assert.strictEqual(res.body.error.code, 'test_limit');
  assert.ok(res.headers['retry-after']);
});
