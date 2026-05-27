// LocalPulse: real-world hazard awareness. All free, no API key.
//   - Open-Meteo: live weather + 2-day forecast -> derived warnings (rain, snow,
//     storm, heat, cold, wind). https://open-meteo.com (free, no key).
//   - USGS: recent earthquakes near the town (Himachal is a high-seismic zone).
//   - NDMA Sachet: official Indian government CAP alerts (IMD/SDMA), filtered to
//     the region. https://sachet.ndma.gov.in
// Each fetch is timeout-bounded and degrades to null/[] so one bad feed never
// breaks the others.

const { BASE } = require('../data/incidents');

// Himachal-distinctive terms only; bare names shared with other states
// (Bilaspur, Hamirpur, Una) are excluded to avoid false positives. The issuing
// authority is also checked: IMD Shimla / HP SDMA issue Himachal alerts.
const REGION_KEYWORDS = (process.env.REGION_KEYWORDS ||
  'himachal,shimla,solan,sirmaur,sirmour,kasauli,parwanoo,arki,nalagarh,kandaghat,baddi,kullu,manali,kangra,dharamshala,palampur,chamba,dalhousie,kinnaur,lahaul,spiti,mandi,nahan,kufri'
).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function getJson(url, ms = 9000, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'LocalPulse/1.0 (+https://localpulse.dmj.one)' }, ...opts });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

// WMO weather interpretation codes -> short label.
function weatherLabel(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
}

async function fetchWeather() {
  const { lat, lng } = BASE;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,precipitation,weather_code,wind_speed_10m` +
    `&daily=precipitation_sum,weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max` +
    `&timezone=Asia%2FKolkata&forecast_days=2`;
  const j = await getJson(url);
  if (!j || !j.current) return null;
  const c = j.current, dy = j.daily || {};
  const warnings = [];
  const precipToday = (dy.precipitation_sum && dy.precipitation_sum[0]) || 0;
  const precipTmrw = (dy.precipitation_sum && dy.precipitation_sum[1]) || 0;
  const maxPrecip = Math.max(precipToday, precipTmrw);
  const codes = (dy.weather_code || []).concat([c.weather_code]);
  const tmax = (dy.temperature_2m_max && Math.max(...dy.temperature_2m_max)) || c.temperature_2m;
  const tmin = (dy.temperature_2m_min && Math.min(...dy.temperature_2m_min)) || c.temperature_2m;
  const windMax = (dy.wind_speed_10m_max && Math.max(...dy.wind_speed_10m_max)) || c.wind_speed_10m;

  if (maxPrecip >= 50) warnings.push({ level: 'high', kind: 'flood', text: `Heavy rain expected (${Math.round(maxPrecip)} mm). Flash-flood / landslide risk. Avoid riverbeds and slopes.` });
  else if (maxPrecip >= 20) warnings.push({ level: 'medium', kind: 'rain', text: `Significant rain expected (${Math.round(maxPrecip)} mm). Roads may be slippery; landslide-prone stretches at risk.` });
  if (codes.some((x) => (x >= 71 && x <= 77) || (x >= 85 && x <= 86))) warnings.push({ level: 'medium', kind: 'snow', text: 'Snowfall likely. Roads may close, power lines at risk. Keep warm supplies.' });
  if (codes.some((x) => x >= 95)) warnings.push({ level: 'medium', kind: 'storm', text: 'Thunderstorm likely. Stay indoors, avoid open areas and trees.' });
  if (tmax >= 40) warnings.push({ level: 'medium', kind: 'heat', text: `High heat (${Math.round(tmax)}°C). Hydrate; check on the elderly.` });
  if (tmin <= 0) warnings.push({ level: 'low', kind: 'cold', text: `Freezing temperatures (${Math.round(tmin)}°C). Cold-wave precautions advised.` });
  if (windMax >= 45) warnings.push({ level: 'medium', kind: 'wind', text: `Strong winds (${Math.round(windMax)} km/h). Secure loose objects.` });

  return {
    tempC: c.temperature_2m,
    condition: weatherLabel(c.weather_code),
    windKmh: c.wind_speed_10m,
    precipTodayMm: Math.round(precipToday * 10) / 10,
    precipTomorrowMm: Math.round(precipTmrw * 10) / 10,
    warnings
  };
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Air quality (Open-Meteo, free, no key). Health-relevant for daily life.
async function fetchAirQuality() {
  const { lat, lng } = BASE;
  const j = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,pm10,us_aqi`);
  if (!j || !j.current) return null;
  const aqi = Math.round(j.current.us_aqi);
  let warning = null;
  if (aqi >= 201) warning = { level: 'high', kind: 'air', text: `Very unhealthy air (AQI ${aqi}). Stay indoors; wear an N95 mask if you must go out.` };
  else if (aqi >= 151) warning = { level: 'medium', kind: 'air', text: `Unhealthy air (AQI ${aqi}). Limit outdoor activity; elderly and children indoors.` };
  else if (aqi >= 101) warning = { level: 'low', kind: 'air', text: `Air is unhealthy for sensitive groups (AQI ${aqi}).` };
  return { aqi, pm25: j.current.pm2_5, pm10: j.current.pm10, warning };
}

// River discharge forecast (Open-Meteo GloFAS, free, no key). Conservative: warn
// only on a sharp forecast surge, to avoid false flood alarms.
async function fetchFlood() {
  const { lat, lng } = BASE;
  const j = await getJson(`https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge&forecast_days=5`);
  const arr = j && j.daily && Array.isArray(j.daily.river_discharge) ? j.daily.river_discharge.filter((x) => typeof x === 'number') : [];
  if (!arr.length) return null;
  const now = arr[0] || 0, max = Math.max(...arr);
  let warning = null;
  if (max > 2 && max >= now * 3) warning = { level: 'medium', kind: 'flood', text: `River discharge forecast to surge (${now.toFixed(1)} → ${max.toFixed(1)} m³/s). Stay clear of riverbanks and low-lying areas.` };
  return { dischargeNow: Math.round(now * 100) / 100, dischargeMax: Math.round(max * 100) / 100, warning };
}

// GDACS global disaster alerts (free, no key): keep India-relevant orange/red.
async function fetchGdacs() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch('https://www.gdacs.org/xml/rss.xml', { signal: ctrl.signal, headers: { 'User-Agent': 'LocalPulse/1.0' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    for (const block of xml.split(/<item>/i).slice(1)) {
      const seg = block.split(/<\/item>/i)[0];
      const pick = (t) => { const m = seg.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };
      const title = pick('title');
      const hay = (title + ' ' + pick('description')).toLowerCase();
      // Strict: must name Himachal or an HP district (avoids "Indian Ocean/Ridge"
      // false positives), and be a significant (orange/red) alert, not green.
      if (!REGION_KEYWORDS.some((k) => hay.includes(k))) continue;
      if (/\bgreen\b/.test(hay) || !/\b(orange|red)\b/.test(hay)) continue;
      out.push({ title: title.slice(0, 200), category: 'GDACS', authority: 'GDACS', link: pick('link'), pubDate: pick('pubDate') });
      if (out.length >= 3) break;
    }
    return out;
  } catch { return []; } finally { clearTimeout(timer); }
}

// NASA EONET open natural events (free, no key) near the region (wildfires, storms, floods).
async function fetchEonet() {
  const j = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=20&limit=80');
  if (!j || !Array.isArray(j.events)) return [];
  const { lat, lng } = BASE;
  const out = [];
  for (const e of j.events) {
    const g = (e.geometry || [])[e.geometry.length - 1];
    const c = g && g.coordinates;
    if (!c || c.length < 2) continue;
    const km = haversineKm(lat, lng, c[1], c[0]);
    if (km > 600) continue;
    out.push({ title: e.title, category: (e.categories && e.categories[0] && e.categories[0].title) || 'Event', km: Math.round(km) });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, 4);
}

async function fetchQuakes() {
  const { lat, lng } = BASE;
  const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lng}&maxradiuskm=350&minmagnitude=2.5&starttime=${start}&orderby=time`;
  const j = await getJson(url);
  if (!j || !Array.isArray(j.features)) return [];
  return j.features.slice(0, 5).map((f) => ({
    mag: f.properties.mag,
    place: f.properties.place,
    time: f.properties.time,
    lat: f.geometry?.coordinates?.[1],
    lng: f.geometry?.coordinates?.[0]
  }));
}

function decode(s) { return String(s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }

// Official NDMA Sachet CAP alerts (IMD / State DMAs), filtered to the region.
async function fetchOfficialAlerts() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch('https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml', { signal: ctrl.signal, headers: { 'User-Agent': 'LocalPulse/1.0 (+https://localpulse.dmj.one)' } });
    if (!r.ok) return [];
    const xml = await r.text();
    const out = [];
    for (const block of xml.split(/<item>/i).slice(1)) {
      const seg = block.split(/<\/item>/i)[0];
      const pick = (t) => { const m = seg.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };
      const title = pick('title');
      if (!title) continue;
      const author = pick('author');
      const hay = (title + ' ' + author).toLowerCase();
      if (!REGION_KEYWORDS.some((k) => hay.includes(k))) continue; // region filter (title + issuing office)
      out.push({ title: title.slice(0, 240), category: pick('category') || 'Alert', authority: (author || '').replace(/^[^(]*\(|\)$/g, ''), link: pick('link'), pubDate: pick('pubDate') });
      if (out.length >= 6) break;
    }
    return out;
  } catch { return []; } finally { clearTimeout(timer); }
}

async function fetchHazards() {
  const [weather, quakes, alerts, air, flood, gdacs, events] = await Promise.all([
    fetchWeather(), fetchQuakes(), fetchOfficialAlerts(), fetchAirQuality(), fetchFlood(), fetchGdacs(), fetchEonet()
  ]);
  // Fold environmental warnings (air, flood) into the weather warnings the DSS reads.
  if (weather) {
    if (air && air.warning) weather.warnings.push(air.warning);
    if (flood && flood.warning) weather.warnings.push(flood.warning);
  }
  // Merge official (NDMA Sachet) + GDACS into one alerts list.
  const allAlerts = [...(alerts || []), ...(gdacs || [])].slice(0, 8);
  return { weather, quakes, alerts: allAlerts, airQuality: air, flood, events: events || [], ts: Date.now() };
}

module.exports = { fetchHazards, fetchWeather, fetchQuakes, fetchOfficialAlerts, fetchAirQuality, fetchFlood, fetchGdacs, fetchEonet };
