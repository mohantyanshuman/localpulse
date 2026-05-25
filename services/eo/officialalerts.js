// Official disaster alerts as an AUTHORITATIVE confirmation source, worldwide + India.
//  - Worldwide: GDACS (Global Disaster Alert & Coordination System) — free, keyless,
//    global CAP feed; matched to a point by latitude/longitude.
//  - India: NDMA "Sachet" national CAP feed, which aggregates the official Indian
//    channels — IMD (weather), CWC (floods), INCOIS (ocean/tsunami), FSI, SDMAs — matched
//    to a point by the reverse-geocoded district/state name (Sachet items carry the area
//    in their text and the issuing channel in the author field).
// The World Engine uses these as a high-trust, agency-in-the-loop confirmer independent
// of our own satellite fusion.
const { getText, haversineKm } = require('./http');
const geolocate = require('../geolocate');

const TYPE_AXIS = { FL: 'flood', WF: 'fire', TC: 'storm', EQ: 'seismic', DR: 'heat' };
const RADIUS_KM = 300;
const INDIA = { latMin: 6, latMax: 37, lngMin: 68, lngMax: 98 };

function decode(s) { return String(s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim(); }

// ---- worldwide: GDACS ----
function parseEvents(xml) {
  const items = String(xml).split(/<item>/i).slice(1);
  const out = [];
  for (const it of items) {
    const get = (re) => { const m = it.match(re); return m ? m[1].trim() : ''; };
    const lat = parseFloat(get(/<geo:lat>([^<]+)<\/geo:lat>/i) || get(/<geo:Point>[\s\S]*?<geo:lat>([^<]+)/i));
    const lng = parseFloat(get(/<geo:long>([^<]+)<\/geo:long>/i) || get(/<geo:Point>[\s\S]*?<geo:long>([^<]+)/i));
    const etype = get(/<gdacs:eventtype>([^<]+)<\/gdacs:eventtype>/i);
    const level = get(/<gdacs:alertlevel>([^<]+)<\/gdacs:alertlevel>/i) || get(/<gdacs:episodealertlevel>([^<]+)/i);
    const title = decode(get(/<title>([^<]*)<\/title>/i));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({ lat, lng, etype, level, title: title.slice(0, 160) });
  }
  return out;
}
function alertsNear(events, lat, lng, radiusKm = RADIUS_KM) {
  const out = [];
  for (const e of events) {
    const axis = TYPE_AXIS[e.etype];
    if (!axis) continue;
    if (!/orange|red/i.test(e.level || '')) continue;
    const distanceKm = haversineKm({ lat, lng }, { lat: e.lat, lng: e.lng });
    if (distanceKm <= radiusKm) out.push({ authority: 'GDACS', scope: 'worldwide', axis, severity: /red/i.test(e.level) ? 'red' : 'orange', distanceKm: Math.round(distanceKm), title: e.title });
  }
  return out;
}
async function fetchGdacs(lat, lng, radiusKm = RADIUS_KM) {
  const xml = await getText('https://www.gdacs.org/xml/rss.xml', 9000);
  if (!xml) return [];
  return alertsNear(parseEvents(xml), lat, lng, radiusKm);
}

// ---- India: NDMA Sachet (IMD / CWC / INCOIS / SDMA) ----
function indiaAxis(text) {
  const t = (text || '').toLowerCase();
  if (/(flood|inundat|river|cwc|water level)/.test(t)) return 'flood';
  if (/(rain|rainfall|monsoon)/.test(t)) return 'flood';
  if (/(thunderstorm|squall|cyclone|storm|gale|wind|depression)/.test(t)) return 'storm';
  if (/(heat ?wave|heat|temperature)/.test(t)) return 'heat';
  if (/(forest fire|wildfire|fire)/.test(t)) return 'fire';
  if (/(earthquake|seismic|tsunami)/.test(t)) return 'seismic';
  if (/(air quality|aqi|pollution|smog)/.test(t)) return 'air';
  return null;
}
function channelOf(author) {
  const a = (author || '').toLowerCase();
  if (a.includes('imd') || a.includes('meteorolog')) return 'IMD';
  if (a.includes('cwc') || a.includes('central water')) return 'CWC';
  if (a.includes('incois') || a.includes('ocean')) return 'INCOIS';
  if (a.includes('sdma')) return 'SDMA';
  if (a.includes('fsi') || a.includes('forest')) return 'FSI';
  return 'NDMA';
}
function parseIndia(xml, regionTerms) {
  const out = [];
  for (const block of String(xml).split(/<item>/i).slice(1)) {
    const seg = block.split(/<\/item>/i)[0];
    const pick = (t) => { const m = seg.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };
    const title = pick('title'); if (!title) continue;
    const author = pick('author');
    const category = pick('category');
    const hay = `${title} ${author} ${category}`.toLowerCase();
    if (!regionTerms.some((k) => k && k.length > 3 && hay.includes(k))) continue; // match this location
    const axis = indiaAxis(`${title} ${category}`); if (!axis) continue;
    const severity = /extreme|red/i.test(hay) ? 'red' : (/severe|orange/i.test(hay) ? 'orange' : 'orange');
    out.push({ authority: channelOf(author), scope: 'india', axis, severity, distanceKm: null, title: title.slice(0, 160) });
  }
  return out;
}
async function fetchIndia(regionTerms) {
  if (!regionTerms || !regionTerms.length) return [];
  const xml = await getText('https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', 9000);
  if (!xml) return [];
  return parseIndia(xml, regionTerms);
}

function byAxis(alerts) {
  const m = {};
  for (const a of alerts) {
    if (!m[a.axis] || (a.severity === 'red' && m[a.axis].severity !== 'red')) m[a.axis] = a;
  }
  return m;
}

// Combined worldwide + India official alerts near a point, mapped per hazard axis.
async function alertsByAxis(lat, lng) {
  const tasks = [fetchGdacs(lat, lng).catch(() => [])];
  const inIndia = lat >= INDIA.latMin && lat <= INDIA.latMax && lng >= INDIA.lngMin && lng <= INDIA.lngMax;
  if (inIndia) {
    tasks.push((async () => {
      const place = await geolocate.reverseGeocode(lat, lng).catch(() => null);
      const terms = place ? [place.place, place.region, place.country].filter(Boolean).map((s) => String(s).toLowerCase()) : [];
      terms.push('india');
      return fetchIndia(terms).catch(() => []);
    })());
  }
  const all = (await Promise.all(tasks)).flat();
  return byAxis(all);
}

module.exports = { parseEvents, alertsNear, fetchGdacs, parseIndia, fetchIndia, indiaAxis, channelOf, byAxis, alertsByAxis, TYPE_AXIS, RADIUS_KM, INDIA };
