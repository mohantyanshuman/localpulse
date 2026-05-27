'use strict';
// In-memory per-IP token-bucket rate limiter. A second, independent layer behind the
// Cloudflare edge (defence in depth): it early-rejects with a tiny static 429 before any
// heavy work (LLM calls, DB writes) touches the request. Single-instance friendly
// (Cloud Run max-instances=1); buckets are pruned when idle so memory stays bounded.
//
// Note on identity: we prefer Cloudflare's CF-Connecting-IP, then the first X-Forwarded-For
// hop. A client that reaches the origin directly could spoof these, which is exactly why
// this complements, never replaces, the Cloudflare edge limiter.

function clientIp(req) {
  const cf = req.headers && req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

// capacity: burst size; refillPerSec: sustained rate; idleMs: prune threshold.
function createLimiter({ capacity = 10, refillPerSec = 0.2, idleMs = 600000 } = {}) {
  const buckets = new Map(); // key -> { tokens, last }
  let lastSweep = Date.now();
  function sweep(now) {
    if (now - lastSweep < idleMs) return;
    lastSweep = now;
    for (const [k, b] of buckets) if (now - b.last > idleMs) buckets.delete(k);
  }
  function take(key) {
    const now = Date.now();
    sweep(now);
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, last: now }; buckets.set(key, b); }
    b.tokens = Math.min(capacity, b.tokens + ((now - b.last) / 1000) * refillPerSec);
    b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
    return { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / refillPerSec)) };
  }
  return { take, _buckets: buckets };
}

// Express middleware factory. `opts.code` customises the error code.
function rateLimit(opts = {}) {
  const lim = createLimiter(opts);
  const code = opts.code || 'rate_limited';
  return function rateLimitMw(req, res, next) {
    const r = lim.take(clientIp(req));
    if (r.ok) return next();
    res.set('Retry-After', String(r.retryAfter));
    res.set('Cache-Control', 'no-store');
    return res.status(429).json({ error: { code, message: 'Too many requests. Please slow down and try again shortly.' } });
  };
}

module.exports = { createLimiter, rateLimit, clientIp };
