// LocalPulse — real-time live feed for the pulse stream.
// A SINGLE shared poller (max-instances=1, so one per deployment) checks the 40+
// FREE sources on a gentle cadence and broadcasts only NEW items to every
// connected SSE client. Key choices:
//   - Runs ONLY while at least one client is watching (no idle cost / no wasted
//     polling); stops when the last client disconnects.
//   - No language-model call per poll — raw headlines are streamed as-is, so the
//     (capped) Gemini budget is never touched and nothing is rate-limited. The
//     scheduled ingest still does the AI classification/verification separately.
//   - Polls free feeds every ~2.5 min, which they tolerate comfortably.
const sources = require('./sources');

const clients = new Set(); // SSE res objects (each tagged res._lpLang)
const seen = new Map(); // url -> firstSeenTs (bounded)
const POLL_MS = Number(process.env.LIVE_POLL_MS || 150000);
let timer = null;
let polling = false;

function broadcast(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(line); } catch { /* dead client */ } }
}

function prune() {
  if (seen.size <= 900) return;
  const entries = [...seen.entries()].sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < entries.length - 700; i++) seen.delete(entries[i][0]);
}

async function pollOnce() {
  if (!clients.size || polling) return;
  polling = true;
  try {
    const raw = await sources.fetchAll();
    if (!raw.length) return;
    const firstRun = seen.size === 0;
    const cutoff = Date.now() - 2 * 864e5;
    const fresh = [];
    for (const x of raw) {
      if (!x.url || seen.has(x.url)) continue;
      seen.set(x.url, Date.now());
      if (!x.publishedAt || x.publishedAt >= cutoff) fresh.push(x);
    }
    prune();
    // First poll just seeds the "seen" set so we don't dump the whole backlog.
    if (firstRun) return;
    fresh.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
    fresh.slice(0, 12).forEach((x) => broadcast('incoming', {
      title: String(x.title).slice(0, 140), source: x.source, url: x.url, ts: x.publishedAt || Date.now(), official: !!x.official
    }));
  } catch { /* ignore this cycle */ } finally { polling = false; }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(pollOnce, POLL_MS);
  pollOnce(); // seed immediately on first client
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

function addClient(res, lang) {
  res._lpLang = lang || 'en';
  clients.add(res);
  ensureTimer();
}
function removeClient(res) {
  clients.delete(res);
  if (!clients.size) stopTimer();
}

module.exports = { addClient, removeClient, broadcast };
