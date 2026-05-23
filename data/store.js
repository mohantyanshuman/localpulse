// LocalPulse — live incident store.
// Holds incidents ingested from real public sources in memory. When empty
// (cold start, ingestion failed, or no relevant items) it transparently falls
// back to the curated seed data so the app is never blank. No persistence by
// design: scale-to-zero friendly and free. Durable cross-instance state is the
// documented upgrade (Firestore free tier).
const seed = require('./incidents');

const state = {
  liveIncidents: [], // normalized incident objects from real sources
  facilities: [], // real relief points/facilities from OpenStreetMap
  hazards: null, // { weather, quakes, alerts } from real-world feeds
  assessment: null, // DSS output: { level, score, recommendations, ... }
  lastIngestTs: 0, // epoch ms of the last successful ingest
  lastSummaryBullets: null, // { en: [..] } overall status summary, if produced
  sourcesIngested: 0, // count of raw items seen in the last ingest (for the ticker)
  mode: 'seed' // 'seed' until the first live ingest lands
};

function setHazards(h) { if (h) state.hazards = h; }
function getHazards() { return state.hazards; }
function setAssessment(a) { if (a) state.assessment = a; }
function getAssessment() { return state.assessment; }

function setFacilities(list) {
  if (Array.isArray(list) && list.length) state.facilities = list;
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
}

// Live data if we have any; otherwise the seed incidents.
function getIncidents() {
  return state.liveIncidents.length ? state.liveIncidents : seed.incidents;
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

module.exports = { setLive, getIncidents, getSummary, setFacilities, getFacilities, setHazards, getHazards, setAssessment, getAssessment, meta, BASE: seed.BASE };
