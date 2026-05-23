// LocalPulse — ingestion orchestrator.
// fetch real posts -> dedupe/cluster -> classify (LLM or heuristic) ->
// normalize into the incident shape the frontend already expects -> store.
// A cooldown guard protects the (Gemini) wallet from being hammered.

const crypto = require('crypto');
const sources = require('./sources');
const brain = require('./brain');
const facilitiesSvc = require('./facilities');
const store = require('../data/store');
const { BASE } = require('../data/incidents');

const MIN_INTERVAL_MS = Number(process.env.INGEST_MIN_INTERVAL_MS || 5 * 60 * 1000);
const MAX_ITEMS = Number(process.env.INGEST_MAX_ITEMS || 40);
let running = false;

// Deterministic small coordinate offset around the town centre. Real geocoding
// (free Nominatim with rate limits) is the documented next step; for now items
// cluster near the configured base so the map stays meaningful.
function jitterCoord(seedStr) {
  const h = crypto.createHash('md5').update(seedStr).digest();
  return { lat: BASE.lat + (h[0] / 255 - 0.5) * 0.12, lng: BASE.lng + (h[1] / 255 - 0.5) * 0.12 };
}

const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);

// Group near-duplicate posts by normalized title; cluster size feeds the trust score.
function dedupe(items) {
  const groups = new Map();
  for (const it of items) {
    const k = normKey(it.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, { rep: it, cluster: 0, official: false });
    const g = groups.get(k);
    g.cluster += 1;
    g.official = g.official || !!it.official;
    if ((it.publishedAt || 0) > (g.rep.publishedAt || 0)) g.rep = it;
  }
  return [...groups.values()].map((g) => ({ ...g.rep, cluster: g.cluster, official: g.official }));
}

function toIncident(x) {
  // Real coordinates from the LLM when available; otherwise approximate near base.
  const co = (typeof x.lat === 'number' && typeof x.lng === 'number')
    ? { lat: x.lat, lng: x.lng }
    : jitterCoord(x.url || x.title);
  const cluster = x.cluster || 1;
  const trust = x.category === 'rumor' ? 0.12 : Math.min(0.55 + cluster * 0.1, 0.95);
  const title = x.titleI18n || { en: x.title };
  const summary = x.summaryI18n || { en: x.summary || x.title };
  return {
    id: 'live-' + crypto.createHash('md5').update(x.url || x.title).digest('hex').slice(0, 8),
    category: x.category,
    severity: x.severity || 'low',
    title,
    summary,
    place: x.place,
    lat: co.lat,
    lng: co.lng,
    sources: cluster,
    verified: x.official ? cluster : 0,
    trust: Number(trust.toFixed(2)),
    updatedAt: x.publishedAt || Date.now(),
    url: x.url,
    src: x.source
  };
}

// force=true bypasses the cooldown. useLLM=false forces the free heuristic
// (the boot warm-up uses this so cold starts never make a paid Gemini call;
// only the scheduled /tasks/ingest spends the daily Gemini budget).
async function runIngest({ force = false, useLLM = true } = {}) {
  if (running) return { skipped: 'already-running' };
  const sinceMs = Date.now() - store.meta().lastIngestTs;
  if (!force && store.meta().lastIngestTs && sinceMs < MIN_INTERVAL_MS) {
    return { skipped: 'cooldown', sinceMs };
  }
  running = true;
  try {
    // Refresh real facilities (free, OSM) independent of news availability.
    try { store.setFacilities(await facilitiesSvc.fetchFacilities()); } catch { /* keep previous */ }

    const raw = await sources.fetchAll();
    if (!raw.length) return { ingested: 0, fetched: 0, facilities: store.getFacilities().length, note: 'no source items' };

    const deduped = dedupe(raw).slice(0, MAX_ITEMS);
    const { items, bullets } = await brain.classifyBatch(deduped, useLLM);

    const incidents = items
      .filter((x) => x.category)
      .map(toIncident)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);

    store.setLive(incidents, {
      sourcesIngested: raw.length,
      // bullets is a {lang: [..]} object from the brain; store as-is.
      summaryBullets: bullets && bullets.en && bullets.en.length ? bullets : null
    });

    return { ingested: incidents.length, fetched: raw.length, llm: useLLM && brain.hasLLM() };
  } catch (err) {
    return { error: err.message };
  } finally {
    running = false;
  }
}

module.exports = { runIngest };
