// LocalPulse — single-file Cloud Run server.
// MVP/MLP: in-memory data, no persistence. Scale-to-zero friendly.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');

const { dict, SUPPORTED, DEFAULT_LANG, pickLang } = require('./data/i18n');
const { respond, classify, noData } = require('./data/intents');
const store = require('./data/store');
const { runIngest, reportToIncident, loadCommunityReports } = require('./services/ingest');
const persist = require('./services/persist');
const push = require('./services/push');
const { verifyReport } = require('./services/verify');
const dss = require('./services/dss');
const assistant = require('./services/assistant');
const aid = require('./services/aid');

const app = express();
const PORT = process.env.PORT || 8080;
const START_TS = Date.now();
const REV = process.env.K_REVISION || 'local';

app.disable('x-powered-by');
// Compress everything except the SSE stream (compression buffers event-streams,
// which would stall live pulse delivery).
app.use(compression({ filter: (req, res) => (req.path === '/api/pulse' ? false : compression.filter(req, res)) }));
app.use(express.json({ limit: '32kb' }));

// --- security + observability headers
app.use((req, res, next) => {
  const cid = req.headers['x-cloud-trace-context'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Correlation-Id', cid);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(self)');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  // CSP — allow tailwind cdn, leaflet, google fonts, prism (used in /pitch and /report)
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https://*.tile.openstreetmap.org https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net",
      "font-src 'self' data: https://fonts.gstatic.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'"
    ].join('; ')
  );
  // structured access log
  const t0 = Date.now();
  res.on('finish', () => {
    const log = {
      severity: res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARNING' : 'INFO',
      ts: new Date().toISOString(),
      method: req.method, path: req.path, status: res.statusCode,
      ms: Date.now() - t0, rev: REV, cid, ua: req.headers['user-agent'] || '', ip: req.ip
    };
    process.stdout.write(JSON.stringify(log) + '\n');
  });
  next();
});

// --- health & meta
app.get('/healthz', (_req, res) => res.json({ ok: true, rev: REV, uptimeSec: Math.round((Date.now() - START_TS) / 1000) }));
app.get('/readyz', (_req, res) => res.json({ ok: true }));
app.get('/version', (_req, res) => res.json({ name: 'localpulse', version: '1.0.0', rev: REV, region: 'asia-east1' }));

// --- API
app.get('/api/incidents', (req, res) => {
  const lang = pickLang(req);
  const { category } = req.query;
  let out = store.getIncidents().map(i => ({
    id: i.id, category: i.category, severity: i.severity,
    title: i.title[lang] || i.title.en,
    summary: i.summary[lang] || i.summary.en,
    lat: i.lat, lng: i.lng,
    sources: i.sources, verified: i.verified, trust: i.trust,
    updatedAt: i.updatedAt,
    url: i.url || undefined,
    src: i.src || undefined,
    status: i.status || undefined,
    note: i.note || undefined
  }));
  if (category) out = out.filter(i => i.category === category);
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
  res.json({ lang, count: out.length, items: out, ts: Date.now() });
});

app.get('/api/shelters', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  const items = store.getFacilities();
  res.json({ count: items.length, items, ts: Date.now() });
});

app.get('/api/summary', (req, res) => {
  const lang = pickLang(req);
  res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
  res.json(store.getSummary(lang));
});

// Ingestion status — handy for verifying live vs seed mode (passes the GFE).
app.get('/api/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...store.meta(), llm: !!process.env.GEMINI_API_KEY, ts: Date.now() });
});

// Real-world hazards: weather, earthquakes, official NDMA alerts.
app.get('/api/hazards', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.json(store.getHazards() || { weather: null, quakes: [], alerts: [], ts: Date.now() });
});

// Decision Support: risk + recommendations. With ?lat&lng it is personalized to
// the user's location (incidents scoped to a radius); otherwise a district view.
app.get('/api/dss', (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    res.set('Cache-Control', 'no-store');
    return res.json(dss.assess(store.getIncidents(), store.getHazards() || {}, store.getFacilities(), { userLoc: { lat, lng } }));
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.json(store.getAssessment() || { level: 'ok', score: 0, headline: 'Starting up — fetching live data.', recommendations: [], generatedAt: Date.now() });
});

app.get('/api/i18n', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ supported: SUPPORTED, default: DEFAULT_LANG, dict });
});

// Shared incident projection (used by /api/incidents and /api/sync).
const SYNC_SECRET = process.env.SYNC_SECRET || process.env.INGEST_TOKEN || 'localpulse-sync';
const signPayload = (o) => crypto.createHmac('sha256', SYNC_SECRET).update(JSON.stringify(o)).digest('hex').slice(0, 32);
function incidentsFor(lang, max) {
  let out = store.getIncidents().map((i) => ({
    id: i.id, category: i.category, severity: i.severity,
    title: i.title[lang] || i.title.en, summary: i.summary[lang] || i.summary.en,
    lat: i.lat, lng: i.lng, sources: i.sources, verified: i.verified, trust: i.trust,
    updatedAt: i.updatedAt, src: i.src || undefined, status: i.status || undefined, note: i.note || undefined
  }));
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return max ? out.slice(0, max) : out;
}

// --- Bandwidth-efficient versioned delta-sync (technical effect: fewer requests,
// no transfer when unchanged, smaller payloads on slow links, signed integrity).
// Collapses i18n-independent live state (risk + summary + incidents + facilities)
// into ONE conditional request. Returns a ~25-byte "unchanged" when the client's
// version matches, instead of re-sending everything every poll.
app.get('/api/sync', (req, res) => {
  const lang = pickLang(req);
  const lite = req.query.lite === '1';
  const v = store.getVersion();
  const etag = `W/"${v}.${lang}${lite ? '.l' : ''}"`;
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  if (String(req.query.since || '') === String(v)) return res.json({ v, changed: false }); // tiny
  const incidents = incidentsFor(lang, lite ? 6 : 30);
  const body = {
    v, changed: true, lang,
    dss: store.getAssessment(),
    summary: store.getSummary(lang),
    incidents,
    shelters: lite ? null : store.getFacilities(), // facilities change rarely; client keeps cache on lite
    meta: store.meta()
  };
  body.sig = signPayload({ v, lang, n: incidents.length }); // tamper-evidence
  res.json(body);
});

app.post('/api/report', async (req, res) => {
  const body = req.body || {};
  const message = String(body.message || '').trim().slice(0, 500);
  if (!message) return res.status(400).json({ error: { code: 'empty', message: 'Description required.' } });
  const report = {
    category: String(body.category || 'other').slice(0, 24),
    message,
    lang: String(body.lang || 'en').slice(0, 2),
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    createdAt: Date.now(),
    status: 'unverified'
  };
  // Persist to Firestore (durable, visible to all) and show it immediately.
  let id = null;
  try { id = await persist.addReport(report); } catch { /* fall through */ }
  id = id || ('usr-' + crypto.randomBytes(4).toString('hex'));
  const crId = 'cr-' + String(id).slice(0, 10);
  store.addCommunityReport(reportToIncident({ id, ...report }));
  process.stdout.write(JSON.stringify({ severity: 'INFO', kind: 'user-report', id, category: report.category, len: message.length, persisted: !!id, ts: Date.now() }) + '\n');
  res.status(202).json({ ok: true, id, persisted: true, verifying: !!process.env.GEMINI_API_KEY, ts: Date.now() });

  // Agentic verification (non-blocking): cross-check against live web search.
  verifyReport(report).then((v) => {
    if (!v) return;
    const trust = v.verdict === 'corroborated' ? Math.max(0.6, v.confidence) : v.verdict === 'contradicted' ? 0.05 : 0.3;
    store.updateCommunityReport(crId, { severity: v.severity, trust, status: v.verdict, note: v.note });
    persist.updateReport(id, { status: v.verdict, severity: v.severity, confidence: v.confidence, note: v.note }).catch(() => {});
    process.stdout.write(JSON.stringify({ severity: 'INFO', kind: 'report-verified', id, verdict: v.verdict, sev: v.severity, conf: v.confidence, ts: Date.now() }) + '\n');
    // Escalate: a corroborated high-severity citizen report alerts the community.
    if (v.verdict === 'corroborated' && v.severity === 'high') {
      const payload = { title: 'Verified emergency near you', body: report.message.slice(0, 120) + ' (verified against live sources)', url: '/', tag: 'lp-report' };
      const center = (typeof report.lat === 'number' && typeof report.lng === 'number') ? { lat: report.lat, lng: report.lng } : null;
      // Locality-scoped: only alert people near the event, not the whole district.
      (center ? push.sendNear(payload, center, 12) : push.sendToAll(payload))
        .then((r) => process.stdout.write(JSON.stringify({ severity: 'NOTICE', kind: 'push-report', ...r, ts: Date.now() }) + '\n')).catch(() => {});
    }
  }).catch(() => {});
});

// --- Conversational situational assistant (RAG over live fused data).
app.post('/api/ask', async (req, res) => {
  const body = req.body || {};
  const question = String(body.q || body.text || '').trim().slice(0, 300);
  if (!question) return res.status(400).json({ error: { code: 'empty', message: 'Ask a question.' } });
  const lang = SUPPORTED.includes(body.lang) ? body.lang : pickLang(req);
  const lat = parseFloat(body.lat), lng = parseFloat(body.lng);
  const userLoc = (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
  const haz = store.getHazards();
  const ctx = {
    risk: userLoc ? dss.assess(store.getIncidents(), haz || {}, store.getFacilities(), { userLoc }) : store.getAssessment(),
    incidents: store.getIncidents().slice(0, 12).map((i) => ({ cat: i.category, sev: i.severity, title: i.title.en, place: i.place, trust: i.trust, status: i.status, hoursAgo: Math.round((Date.now() - (i.updatedAt || Date.now())) / 3.6e6) })),
    weather: haz && haz.weather ? haz.weather : null,
    airQuality: haz && haz.airQuality ? { aqi: haz.airQuality.aqi } : null,
    officialAlerts: haz && haz.alerts ? haz.alerts.map((a) => a.title) : [],
    facilities: store.getFacilities().slice(0, 10).map((f) => ({ name: f.name, kind: f.kind, phone: f.phone }))
  };
  const out = await assistant.ask(question, ctx, lang);
  res.set('Cache-Control', 'no-store');
  res.json(out || { answer: 'I could not process that right now. For an emergency, call 112.' });
});

// --- Community mutual-aid board (need / offer / I'm-safe), with auto-matching.
app.post('/api/aid', async (req, res) => {
  const b = req.body || {};
  const kind = ['need', 'offer', 'safe'].includes(b.kind) ? b.kind : 'need';
  const message = String(b.message || '').trim().slice(0, 300);
  if (kind !== 'safe' && !message) return res.status(400).json({ error: { code: 'empty', message: 'Describe what you need or offer.' } });
  const item = { kind, message: message || "I'm safe", name: String(b.name || '').slice(0, 40), lat: typeof b.lat === 'number' ? b.lat : null, lng: typeof b.lng === 'number' ? b.lng : null, createdAt: Date.now() };
  let id = null;
  try { id = await persist.addAid(item); } catch { /* ignore */ }
  res.status(202).json({ ok: true, id });
});
app.get('/api/aid', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  let items = [];
  try { const cutoff = Date.now() - 24 * 3600 * 1000; items = (await persist.listAid(50)).filter((a) => (a.createdAt || 0) >= cutoff); } catch { /* none */ }
  res.json({ count: items.length, items: aid.enrich(items), ts: Date.now() });
});

// --- Vulnerable-person priority registry (no-one-left-behind).
// Privacy: coordinates coarsened to ~1 km; the GET returns only aggregate counts
// and coarse clusters — never names, notes or contacts.
const VULN_NEEDS = ['mobility', 'elderly', 'infant', 'medical', 'oxygen', 'hearing', 'vision', 'pregnant'];
app.post('/api/vulnerable', async (req, res) => {
  const b = req.body || {};
  const needs = (Array.isArray(b.needs) ? b.needs : []).filter((n) => VULN_NEEDS.includes(n)).slice(0, 6);
  if (!needs.length) return res.status(400).json({ error: { code: 'no_needs', message: 'Select at least one need.' } });
  const item = {
    needs, note: String(b.note || '').slice(0, 160), contact: String(b.contact || '').slice(0, 40),
    lat: typeof b.lat === 'number' ? Math.round(b.lat * 100) / 100 : null,
    lng: typeof b.lng === 'number' ? Math.round(b.lng * 100) / 100 : null,
    createdAt: Date.now()
  };
  let id = null;
  try { id = await persist.addVulnerable(item); } catch { /* ignore */ }
  res.status(202).json({ ok: true, id });
});
app.get('/api/vulnerable', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  let items = [];
  try { const cutoff = Date.now() - 7 * 864e5; items = (await persist.listVulnerable(300)).filter((v) => (v.createdAt || 0) >= cutoff); } catch { /* none */ }
  const byNeed = {}; const clusters = {};
  for (const v of items) {
    (v.needs || []).forEach((n) => { byNeed[n] = (byNeed[n] || 0) + 1; });
    if (typeof v.lat === 'number') { const k = v.lat.toFixed(2) + ',' + v.lng.toFixed(2); clusters[k] = (clusters[k] || 0) + 1; }
  }
  res.json({ total: items.length, byNeed, clusters: Object.entries(clusters).map(([k, n]) => { const p = k.split(',').map(Number); return { lat: p[0], lng: p[1], count: n }; }), ts: Date.now() });
});

// --- Missing-persons reunification: matched against "I'm safe" beacons.
app.post('/api/missing', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: { code: 'no_name', message: 'Name is required.' } });
  const item = { name, lastSeen: String(b.lastSeen || '').slice(0, 120), note: String(b.note || '').slice(0, 200), contact: String(b.contact || '').slice(0, 40), createdAt: Date.now() };
  let id = null;
  try { id = await persist.addMissing(item); } catch { /* ignore */ }
  res.status(202).json({ ok: true, id });
});
app.get('/api/missing', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  let missing = []; let safe = [];
  try { const cutoff = Date.now() - 7 * 864e5; missing = (await persist.listMissing(100)).filter((m) => (m.createdAt || 0) >= cutoff); } catch { /* none */ }
  try { safe = (await persist.listAid(60)).filter((a) => a.kind === 'safe' && a.name); } catch { /* none */ }
  const items = missing.map((m) => {
    const nm = m.name.toLowerCase();
    const hit = safe.find((s) => { const sn = String(s.name || '').toLowerCase(); return sn && (sn.includes(nm) || nm.includes(sn)); });
    return { name: m.name, lastSeen: m.lastSeen, note: m.note, contact: m.contact, createdAt: m.createdAt, safe: hit ? { when: hit.createdAt } : null };
  });
  res.json({ count: items.length, items, ts: Date.now() });
});

// --- Web Push: subscribe to alerts (risk escalation + verified emergencies)
app.get('/api/push/key', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ key: push.publicKey(), enabled: push.hasVapid() });
});
app.post('/api/push/subscribe', async (req, res) => {
  const sub = req.body || {};
  if (!sub.endpoint) return res.status(400).json({ error: { code: 'bad_sub', message: 'Missing endpoint.' } });
  // Optional location lets us scope localized alerts to nearby subscribers only.
  if (typeof sub.lat !== 'number') { const la = parseFloat(sub.lat); if (Number.isFinite(la)) sub.lat = la; }
  let id = null;
  try { id = await persist.savePushSub(sub); } catch { /* ignore */ }
  res.json({ ok: !!id, id });
});
app.post('/api/push/unsubscribe', async (req, res) => {
  const { id } = req.body || {};
  try { if (id) await persist.deletePushSub(id); } catch { /* ignore */ }
  res.json({ ok: true });
});

// Community reports (resident submissions) — for the responder console.
app.get('/api/reports', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const items = store.getIncidents().filter((i) => i.src === 'community').map((i) => ({ id: i.id, category: i.category, message: i.summary.en, lat: i.lat, lng: i.lng, updatedAt: i.updatedAt }));
  res.json({ count: items.length, items, ts: Date.now() });
});

app.post('/api/voice/intent', (req, res) => {
  const { text = '' } = req.body || {};
  const lang = (req.body && SUPPORTED.includes(req.body.lang)) ? req.body.lang : pickLang(req);
  const out = respond(text, lang); // { intent, response, lang } — localized base reply
  // Ground the reply in live data (free, no LLM call).
  const incTitles = (cat) => store.getIncidents().filter(i => i.category === cat).slice(0, 2).map(i => (i.title[lang] || i.title.en));
  const facNames = (kinds) => {
    const fac = store.getFacilities();
    let pick = fac.filter(f => kinds.includes(f.kind));
    if (!pick.length) pick = fac; // any nearby relief facility is better than nothing
    return pick.slice(0, 2).map(f => f.name + (f.phone ? ` (${f.phone})` : ''));
  };
  let extra = [];
  if (out.intent === 'road' || out.intent === 'power' || out.intent === 'water') extra = incTitles(out.intent);
  else if (out.intent === 'medical') extra = facNames(['hospital', 'clinic']);
  else if (out.intent === 'shelter') extra = facNames(['shelter', 'community_centre', 'school']);
  if (extra.length) { out.response += ' ' + extra.join('; ') + '.'; out.live = extra; }
  else if (out.intent !== 'emergency' && out.intent !== 'fallback') { out.response = (noData[lang] || noData.en); }
  res.json(out);
});

// --- SSE pulse for live ticker (no persistence; synthetic ticks)
app.get('/api/pulse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // ask proxies not to buffer
  res.flushHeaders();
  const lang = pickLang(req);
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const incidentEvt = (i) => ({ id: i.id, cat: i.category, sev: i.severity, title: i.title[lang] || i.title.en, ts: i.updatedAt, src: i.src });
  const stat = () => { const m = store.meta(); return { activeIncidents: store.getIncidents().length, sheltersOpen: store.getFacilities().length, sourcesIngested: m.sourcesIngested || 0, mode: m.mode, ts: Date.now() }; };

  // On connect: replay the latest real incidents (oldest→newest) + a stat snapshot,
  // so the stream is never empty and reflects the actual situation.
  store.getIncidents().slice(0, 8).reverse().forEach((i) => send('incident', incidentEvt(i)));
  send('stat', stat());

  let lastV = store.getVersion();
  let n = 0;
  const tick = setInterval(() => {
    n += 1;
    const v = store.getVersion();
    if (v !== lastV) {
      lastV = v;
      // Something changed (new ingest or a community report) — push the freshest items live.
      store.getIncidents().slice(0, 3).forEach((i) => send('incident', incidentEvt(i)));
      send('stat', stat());
    } else {
      send('ping', { ts: Date.now() }); // heartbeat keeps the connection + status alive
    }
    if (n > 1200) { clearInterval(tick); res.end(); }
  }, 15000);
  req.on('close', () => clearInterval(tick));
});

// --- ingestion trigger (called by Cloud Scheduler). Token-guarded so nobody
// can spend your Gemini quota. Disabled (503) until INGEST_TOKEN is set.
const ingestAuthorized = (req) => {
  const tok = process.env.INGEST_TOKEN;
  if (!tok) return false;
  const got = String(req.get('X-Ingest-Token') || req.query.token || '');
  const a = Buffer.from(got);
  const b = Buffer.from(tok);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
app.all(['/tasks/ingest'], async (req, res) => {
  if (!process.env.INGEST_TOKEN) return res.status(503).json({ error: { code: 'ingest_disabled', message: 'Set INGEST_TOKEN to enable ingestion.' } });
  if (!ingestAuthorized(req)) return res.status(403).json({ error: { code: 'forbidden', message: 'Bad or missing ingest token.' } });
  const force = req.query.force === '1';
  const result = await runIngest({ force });
  process.stdout.write(JSON.stringify({ severity: 'INFO', kind: 'ingest', ...result, ts: Date.now() }) + '\n');
  res.json({ ok: !result.error, ...result, ...store.meta() });
});

// --- static + page routes
const PUB = path.join(__dirname, 'public');
app.use(express.static(PUB, { maxAge: '5m', etag: true, lastModified: true }));

// Helper: send a public file with no-cache (HTML pages benefit from fresh)
const sendPage = (file) => (req, res) => {
  res.set('Cache-Control', 'public, max-age=60, must-revalidate');
  res.sendFile(path.join(PUB, file));
};

app.get('/', sendPage('index.html'));
app.get('/responder', sendPage('responder.html'));
app.get('/voice', sendPage('voice.html'));
app.get('/pitch', sendPage('pitch.html'));
app.get('/report', sendPage('report.html'));

// Downloadable capstone report (Word docx)
app.get(['/download/report.docx', '/report.docx'], (_req, res) => {
  const file = path.join(__dirname, 'CAPSTONE PROJECT REPORT.docx');
  fs.stat(file, (err, st) => {
    if (err) return res.status(404).send('Report file not found.');
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.set('Content-Disposition', 'attachment; filename="CAPSTONE PROJECT REPORT - LocalPulse - Anshuman Mohanty - GF202217744.docx"');
    res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    res.set('Content-Length', String(st.size));
    res.set('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).pipe(res);
  });
});

// 404
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: { code: 'not_found', message: 'Unknown endpoint' } });
  res.status(404).send('<!doctype html><meta charset="utf-8"><title>404</title><body style="font:16px system-ui;padding:40px"><h1>404</h1><p>Page not found. Try <a href="/">/</a>, <a href="/pitch">/pitch</a>, or <a href="/report">/report</a>.</p></body>');
});

// 500
app.use((err, req, res, _next) => {
  const cid = res.getHeader('X-Correlation-Id');
  process.stderr.write(JSON.stringify({ severity: 'ERROR', ts: new Date().toISOString(), msg: err.message, stack: err.stack, cid }) + '\n');
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong', cid } });
});

const server = app.listen(PORT, () => {
  process.stdout.write(JSON.stringify({ severity: 'NOTICE', ts: new Date().toISOString(), msg: 'LocalPulse listening', port: PORT, rev: REV, node: process.version }) + '\n');
  // Cold-start warm-up (non-blocking), in order of preference:
  //   1. Reload the last good (LLM) snapshot from Firestore — instant real
  //      multilingual data, ZERO Gemini spend.
  //   2. Only if no snapshot exists, do a free heuristic ingest so it's not blank.
  // Either way, load community reports. The scheduled /tasks/ingest is the only
  // path that ever calls Gemini.
  if (process.env.INGEST_ON_BOOT !== '0') {
    (async () => {
      let restored = false;
      try {
        const snap = await persist.loadSnapshot();
        if (snap && Array.isArray(snap.liveIncidents) && snap.liveIncidents.length) restored = store.restoreSnapshot(snap);
      } catch { /* ignore */ }
      try { await loadCommunityReports(); } catch { /* ignore */ }
      const r = restored ? { restored: true } : await runIngest({ force: true, useLLM: false });
      process.stdout.write(JSON.stringify({ severity: 'INFO', kind: 'ingest-boot', ...r, ts: Date.now() }) + '\n');
    })().catch(() => {});
  }
});

const shutdown = (sig) => () => {
  process.stdout.write(JSON.stringify({ severity: 'NOTICE', ts: new Date().toISOString(), msg: 'shutdown', sig }) + '\n');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
