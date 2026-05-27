// LocalPulse: ingestion orchestrator.
// fetch real posts -> dedupe/cluster -> classify (LLM or heuristic) ->
// normalize into the incident shape the frontend already expects -> store.
// A cooldown guard protects the (Gemini) wallet from being hammered.

const crypto = require('crypto');
const sources = require('./sources');
const brain = require('./brain');
const facilitiesSvc = require('./facilities');
const hazardsSvc = require('./hazards');
const dss = require('./dss');
const persist = require('./persist');
const push = require('./push');
const store = require('../data/store');
const { BASE } = require('../data/incidents');

// Map a persisted community report to the incident shape used everywhere.
function reportToIncident(r) {
  const msg = String(r.message || '').trim();
  return {
    id: 'cr-' + String(r.id || crypto.randomBytes(4).toString('hex')).slice(0, 10),
    category: r.category || 'other',
    severity: r.severity || 'low',
    title: { en: msg.slice(0, 80) || 'Community report' },
    summary: { en: msg || 'Community report' },
    lat: typeof r.lat === 'number' ? r.lat : BASE.lat,
    lng: typeof r.lng === 'number' ? r.lng : BASE.lng,
    sources: 1, verified: 0, trust: 0.3,
    updatedAt: r.createdAt || Date.now(),
    src: 'community'
  };
}

// Pull recent (48h) community reports from Firestore into the store.
async function loadCommunityReports() {
  try {
    const cutoff = Date.now() - 48 * 3600 * 1000;
    const reps = (await persist.listReports(50)).filter((r) => (r.createdAt || 0) >= cutoff);
    store.setCommunityReports(reps.map(reportToIncident));
  } catch { /* leave as-is */ }
}

// Recompute the DSS assessment; alert subscribers when risk RISES into high/severe.
const LEVEL_RANK = { ok: 0, elevated: 1, high: 2, severe: 3 };
let lastLevel = null; // null until primed by the first assessment (no push on boot)
function refreshAssessment() {
  try {
    const a = dss.assess(store.getIncidents(), store.getHazards() || {}, store.getFacilities());
    store.setAssessment(a);
    if (a) {
      // Only alert everyone for a genuine DISTRICT-WIDE escalation (severe weather,
      // official alert, large quake). A single localized incident must not blast
      // the whole town; that would just scare people who are nowhere near it.
      if (lastLevel !== null && LEVEL_RANK[a.level] > LEVEL_RANK[lastLevel] && LEVEL_RANK[a.level] >= 2 && a.areaWide) {
        push.sendToAll({ title: `LocalPulse: ${a.level === 'severe' ? 'Severe' : 'High'} risk in your district`, body: a.headline, url: '/', tag: 'lp-risk' })
          .then((r) => process.stdout.write(JSON.stringify({ severity: 'NOTICE', kind: 'push-risk', level: a.level, ...r, ts: Date.now() }) + '\n')).catch(() => {});
      }
      lastLevel = a.level;
    }
  } catch { /* keep previous */ }
}

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
    // Refresh real facilities + real-world hazards + community reports (free).
    try { store.setFacilities(await facilitiesSvc.fetchFacilities()); } catch { /* keep previous */ }
    try { store.setHazards(await hazardsSvc.fetchHazards()); } catch { /* keep previous */ }
    await loadCommunityReports();

    const raw = await sources.fetchAll();
    // Freshness filter: drop articles older than a few days so re-surfaced
    // past-monsoon coverage can't masquerade as a current emergency. This is the
    // first line of defence against stale-event fear-mongering (decay is the second).
    const MAX_AGE = Number(process.env.SOURCE_MAX_AGE_DAYS || 5) * 864e5;
    const fresh = raw.filter((x) => !x.publishedAt || (Date.now() - x.publishedAt) <= MAX_AGE);
    if (!fresh.length) { refreshAssessment(); return { ingested: 0, fetched: raw.length, fresh: 0, facilities: store.getFacilities().length, note: 'no fresh items' }; }

    const deduped = dedupe(fresh).slice(0, MAX_ITEMS);
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
    refreshAssessment();
    // Persist the good (LLM) snapshot so cold starts reload it without spending
    // the Gemini budget. Heuristic ingests don't overwrite the good snapshot.
    if (useLLM && brain.hasLLM()) { try { await persist.saveSnapshot(store.snapshot()); } catch { /* best effort */ } }

    return { ingested: incidents.length, fetched: raw.length, llm: useLLM && brain.hasLLM() };
  } catch (err) {
    return { error: err.message };
  } finally {
    running = false;
  }
}

module.exports = { runIngest, reportToIncident, loadCommunityReports };
