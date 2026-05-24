// Per-cell, per-source TTL cache. The rate-limit and latency shield: nearby
// users hitting the same ~0.1 deg cell reuse one upstream fetch per source.
const store = new Map(); // key -> { ts, val }
const MAX = 2000;

function cellKey(lat, lng, prec = 1) {
  const f = Math.pow(10, prec);
  return `${Math.round(lat * f) / f},${Math.round(lng * f) / f}`;
}

async function memo(key, ttlMs, fn) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.ts < ttlMs) return hit.val;
  const val = await fn();
  store.set(key, { ts: now, val });
  if (store.size > MAX) {
    const oldest = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, Math.floor(MAX / 4));
    for (const [k] of oldest) store.delete(k);
  }
  return val;
}

function _reset() { store.clear(); }

module.exports = { cellKey, memo, _reset };
