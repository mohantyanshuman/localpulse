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
const { runIngest } = require('./services/ingest');

const app = express();
const PORT = process.env.PORT || 8080;
const START_TS = Date.now();
const REV = process.env.K_REVISION || 'local';

app.disable('x-powered-by');
app.use(compression());
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
    url: i.url || undefined
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

// Decision Support: town risk level + actionable recommendations.
app.get('/api/dss', (req, res) => {
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
  res.json(store.getAssessment() || { level: 'ok', score: 0, headline: 'Starting up — fetching live data.', recommendations: [], generatedAt: Date.now() });
});

app.get('/api/i18n', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ supported: SUPPORTED, default: DEFAULT_LANG, dict });
});

app.post('/api/report', (req, res) => {
  const { category = 'other', message = '', lat, lng, lang = 'en' } = req.body || {};
  const id = 'usr-' + crypto.randomBytes(4).toString('hex');
  // No persistence by design — echo back acknowledgement only.
  process.stdout.write(JSON.stringify({ severity: 'INFO', kind: 'user-report', id, category, len: message.length, lat, lng, lang, ts: Date.now() }) + '\n');
  res.status(202).json({ ok: true, id, queued: true, ts: Date.now() });
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
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  let n = 0;
  const tick = setInterval(() => {
    n += 1;
    const m = store.meta();
    const evt = {
      n, ts: Date.now(),
      activeIncidents: store.getIncidents().length,
      sheltersOpen: store.getFacilities().length,
      sourcesIngested: m.sourcesIngested || 0,
      mode: m.mode
    };
    res.write(`event: pulse\ndata: ${JSON.stringify(evt)}\n\n`);
    if (n > 600) { clearInterval(tick); res.end(); }
  }, 5000);
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
  // Warm up live data on boot (non-blocking) using the FREE heuristic only — a
  // cold start must never spend the Gemini budget. The scheduled /tasks/ingest
  // is the only path that calls Gemini (the daily cap = its cron frequency).
  if (process.env.INGEST_ON_BOOT !== '0') {
    runIngest({ force: true, useLLM: false })
      .then((r) => process.stdout.write(JSON.stringify({ severity: 'INFO', kind: 'ingest-boot', ...r, ts: Date.now() }) + '\n'))
      .catch(() => {});
  }
});

const shutdown = (sig) => () => {
  process.stdout.write(JSON.stringify({ severity: 'NOTICE', ts: new Date().toISOString(), msg: 'shutdown', sig }) + '\n');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
