// LocalPulse — Firestore persistence over REST (dependency-free).
// Auth uses the Cloud Run metadata server access token (the runtime service
// account has roles/datastore.user). Two uses:
//   1. Community reports — residents' submissions, durable + visible to all.
//   2. Snapshot — the last good (LLM) ingest, so a cold start reloads real
//      multilingual data instantly without spending the Gemini budget.
// Every call degrades to null/[]/false if Firestore or the token is unavailable
// (e.g. local dev), so the app never breaks.

const PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'dmjone';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

let tok = { value: null, exp: 0 };
async function token() {
  if (tok.value && Date.now() < tok.exp) return tok.value;
  try {
    const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
    if (!r.ok) return null;
    const j = await r.json();
    tok = { value: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
    return tok.value;
  } catch { return null; }
}

// --- Firestore typed-value encoding/decoding
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  return { stringValue: String(v) };
}
function encFields(o) { const f = {}; for (const k in o) f[k] = enc(o[k]); return f; }
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  return null;
}
function decFields(f) { const o = {}; for (const k in f) o[k] = dec(f[k]); return o; }

async function req(method, path, body) {
  const t = await token();
  if (!t) return null;
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// --- Community reports
async function addReport(rep) {
  const doc = await req('POST', '/reports', { fields: encFields(rep) });
  return doc ? (doc.name || '').split('/').pop() : null;
}
async function listReports(limit = 40) {
  const body = { structuredQuery: { from: [{ collectionId: 'reports' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit } };
  const rows = await req('POST', ':runQuery', body);
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...decFields(r.document.fields || {}) }));
}

// --- Update fields on an existing report (verification verdict)
async function updateReport(id, fields) {
  if (!id) return false;
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const r = await req('PATCH', `/reports/${id}?${mask}`, { fields: encFields(fields) });
  return !!r;
}

// --- Vulnerable-person priority registry (no-one-left-behind).
// Privacy-first: coordinates are coarsened to ~1 km before storage and the public
// API only ever returns aggregate counts + coarse clusters, never precise PII.
async function addVulnerable(item) {
  const doc = await req('POST', '/vulnerable', { fields: encFields(item) });
  return doc ? (doc.name || '').split('/').pop() : null;
}
async function listVulnerable(limit = 200) {
  const body = { structuredQuery: { from: [{ collectionId: 'vulnerable' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit } };
  const rows = await req('POST', ':runQuery', body);
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...decFields(r.document.fields || {}) }));
}

// --- Missing-persons board (for family reunification against "I'm safe" beacons)
async function addMissing(item) {
  const doc = await req('POST', '/missing', { fields: encFields(item) });
  return doc ? (doc.name || '').split('/').pop() : null;
}
async function listMissing(limit = 100) {
  const body = { structuredQuery: { from: [{ collectionId: 'missing' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit } };
  const rows = await req('POST', ':runQuery', body);
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...decFields(r.document.fields || {}) }));
}

// --- Mutual-aid board: residents requesting/offering help, or marking "I'm safe"
async function addAid(item) {
  const doc = await req('POST', '/aid', { fields: encFields(item) });
  return doc ? (doc.name || '').split('/').pop() : null;
}
async function listAid(limit = 40) {
  const body = { structuredQuery: { from: [{ collectionId: 'aid' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit } };
  const rows = await req('POST', ':runQuery', body);
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split('/').pop(), ...decFields(r.document.fields || {}) }));
}

// --- Web-push subscriptions (doc id = sha256 of endpoint, so upserts dedupe)
const crypto = require('crypto');
async function savePushSub(sub) {
  if (!sub || !sub.endpoint) return null;
  const id = crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 40);
  const r = await req('PATCH', `/pushsubs/${id}`, { fields: encFields({
    endpoint: sub.endpoint, p256dh: sub.keys?.p256dh || '', auth: sub.keys?.auth || '',
    lat: typeof sub.lat === 'number' ? sub.lat : null,
    lng: typeof sub.lng === 'number' ? sub.lng : null,
    createdAt: Date.now()
  }) });
  return r ? id : null;
}
async function deletePushSub(id) { if (id) await req('DELETE', `/pushsubs/${id}`); }
async function listPushSubs(limit = 500) {
  const r = await req('GET', `/pushsubs?pageSize=${limit}`);
  if (!r || !Array.isArray(r.documents)) return [];
  return r.documents.map((d) => ({ id: d.name.split('/').pop(), ...decFields(d.fields || {}) }));
}

// --- Snapshot of the last good ingest (stored as one JSON string field)
async function saveSnapshot(obj) {
  const r = await req('PATCH', '/state/latest', { fields: encFields({ json: JSON.stringify(obj), updatedAt: Date.now() }) });
  return !!r;
}
async function loadSnapshot() {
  const r = await req('GET', '/state/latest');
  if (!r || !r.fields) return null;
  try { return JSON.parse(decFields(r.fields).json); } catch { return null; }
}

module.exports = { addReport, listReports, updateReport, addAid, listAid, addVulnerable, listVulnerable, addMissing, listMissing, savePushSub, deletePushSub, listPushSubs, saveSnapshot, loadSnapshot };
