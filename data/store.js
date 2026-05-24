// LocalPulse — live incident store.
// Holds incidents ingested from real public sources in memory. When empty
// (cold start, ingestion failed, or no relevant items) it transparently falls
// back to the curated seed data so the app is never blank. No persistence by
// design: scale-to-zero friendly and free. Durable cross-instance state is the
// documented upgrade (Firestore free tier).
const seed = require('./incidents');

const state = {
  liveIncidents: [], // normalized incident objects from real sources
  communityReports: [], // resident submissions (incident shape, src='community')
  facilities: [], // real relief points/facilities from OpenStreetMap
  hazards: null, // { weather, quakes, alerts } from real-world feeds
  assessment: null, // DSS output: { level, score, recommendations, ... }
  lastIngestTs: 0, // epoch ms of the last successful ingest
  lastSummaryBullets: null, // { en: [..] } overall status summary, if produced
  sourcesIngested: 0, // count of raw items seen in the last ingest (for the ticker)
  mode: 'seed' // 'seed' until the first live ingest lands
};

function setCommunityReports(list) { state.communityReports = Array.isArray(list) ? list.slice(0, 50) : []; bumpVersion(); }
function addCommunityReport(inc) { if (inc) { state.communityReports = [inc, ...state.communityReports].slice(0, 50); bumpVersion(); } }
// Apply an agentic verification verdict to a community report (matched by id).
function updateCommunityReport(crId, patch) {
  const r = state.communityReports.find((x) => x.id === crId);
  if (!r) return false;
  if (patch.severity) r.severity = patch.severity;
  if (typeof patch.trust === 'number') r.trust = patch.trust;
  if (patch.status) r.status = patch.status;
  if (patch.note) r.note = patch.note;
  return true;
}

// Full state to persist, and a way to restore it on a cold start.
function snapshot() {
  return { liveIncidents: state.liveIncidents, facilities: state.facilities, hazards: state.hazards, assessment: state.assessment, lastSummaryBullets: state.lastSummaryBullets, sourcesIngested: state.sourcesIngested, lastIngestTs: state.lastIngestTs };
}
function restoreSnapshot(s) {
  if (!s || typeof s !== 'object') return false;
  if (Array.isArray(s.liveIncidents)) state.liveIncidents = s.liveIncidents;
  if (Array.isArray(s.facilities)) state.facilities = s.facilities;
  if (s.hazards) state.hazards = s.hazards;
  if (s.assessment) state.assessment = s.assessment;
  if (s.lastSummaryBullets) state.lastSummaryBullets = s.lastSummaryBullets;
  if (typeof s.sourcesIngested === 'number') state.sourcesIngested = s.sourcesIngested;
  if (typeof s.lastIngestTs === 'number') state.lastIngestTs = s.lastIngestTs;
  state.mode = state.liveIncidents.length ? 'live' : 'seed';
  return true;
}

// Monotonic state version — bumped on any change. Enables tiny delta-sync:
// clients send their last version and get a full transfer only when it changed.
let version = 1;
function bumpVersion() { version += 1; }
function getVersion() { return version; }

function setHazards(h) { if (h) { state.hazards = h; bumpVersion(); } }
function getHazards() { return state.hazards; }
function setAssessment(a) { if (a) { state.assessment = a; bumpVersion(); } }
function getAssessment() { return state.assessment; }

function setFacilities(list) {
  if (Array.isArray(list) && list.length) { state.facilities = list; bumpVersion(); }
}

// Real OSM facilities if we have them; otherwise the seed shelters mapped to the
// same shape so /api/shelters and the UI keep working.
function getFacilities() {
  if (state.facilities.length) return state.facilities;
  return seed.shelters.map((s) => ({ id: s.id, name: s.name, kind: 'shelter', lat: s.lat, lng: s.lng, phone: null }));
}

function setLive(incidents, meta = {}) {
  state.liveIncidents = Array.isArray(incidents) ? incidents : [];
  state.lastIngestTs = Date.now();
  state.mode = state.liveIncidents.length ? 'live' : 'seed';
  if (typeof meta.sourcesIngested === 'number') state.sourcesIngested = meta.sourcesIngested;
  if (meta.summaryBullets) state.lastSummaryBullets = meta.summaryBullets;
  bumpVersion();
}

// Community reports first (most immediate), then live (or seed) incidents.
function getIncidents() {
  const base = state.liveIncidents.length ? state.liveIncidents : seed.incidents;
  return state.communityReports.length ? [...state.communityReports, ...base] : base;
}

// Mirror the seed summary() shape exactly so the frontend needs no changes.
function getSummary(lang = 'en') {
  if (state.lastSummaryBullets && state.lastSummaryBullets[lang]) {
    return { generatedAt: state.lastIngestTs, window: '60m', language: lang, mode: 'live', bullets: state.lastSummaryBullets[lang] };
  }
  if (state.liveIncidents.length) {
    // Derive bullets from the freshest live incidents (en, with per-lang fallback).
    const bullets = state.liveIncidents.slice(0, 6).map(i => (i.title && (i.title[lang] || i.title.en)) || '').filter(Boolean);
    return { generatedAt: state.lastIngestTs, window: '60m', language: lang, mode: 'live', bullets };
  }
  return { ...seed.summary(lang), mode: 'seed' };
}

function meta() {
  return {
    mode: state.mode,
    lastIngestTs: state.lastIngestTs,
    liveCount: state.liveIncidents.length,
    sourcesIngested: state.sourcesIngested
  };
}

module.exports = { setLive, getIncidents, getSummary, setFacilities, getFacilities, setHazards, getHazards, setAssessment, getAssessment, setCommunityReports, addCommunityReport, updateCommunityReport, getVersion, bumpVersion, snapshot, restoreSnapshot, meta, BASE: seed.BASE };
