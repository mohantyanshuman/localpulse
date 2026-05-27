// LocalPulse: real relief points & facilities from OpenStreetMap (Overpass API).
// Free, no API key. Returns real hospitals, clinics, police stations, community
// centres and schools near the configured town: the actual places residents go
// to in a crisis. Replaces the previous mock "shelters". Timeout-bounded; returns
// [] on failure so the caller falls back to seed data.

const { BASE } = require('../data/incidents');

const RADIUS_M = Number(process.env.FACILITIES_RADIUS_M || 25000);
const ENDPOINT = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const KINDS = ['hospital', 'clinic', 'police', 'community_centre', 'school'];
// Display priority: what a crisis user wants nearest hand first.
const RANK = { hospital: 0, police: 1, community_centre: 2, clinic: 3, shelter: 4, school: 5, facility: 6 };

async function fetchFacilities() {
  const { lat, lng } = BASE;
  const around = `(around:${RADIUS_M},${lat},${lng})`;
  const q = `[out:json][timeout:25];(` +
    KINDS.map((k) => `node["amenity"="${k}"]${around};`).join('') +
    `node["emergency"="shelter"]${around};` +
    `);out body 150;`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'LocalPulse/1.0 (+https://localpulse.dmj.one)' },
      body: 'data=' + encodeURIComponent(q),
      signal: ctrl.signal
    });
    if (!r.ok) return [];
    const j = await r.json();
    const seen = new Set();
    const out = [];
    for (const e of j.elements || []) {
      const tg = e.tags || {};
      const name = tg.name || tg['name:en'];
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: 'osm-' + e.id,
        name: String(name).slice(0, 80),
        kind: tg.emergency === 'shelter' ? 'shelter' : (tg.amenity || 'facility'),
        lat: e.lat,
        lng: e.lon,
        phone: tg.phone || tg['contact:phone'] || null
      });
    }
    out.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));
    return out.slice(0, 40);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchFacilities };
