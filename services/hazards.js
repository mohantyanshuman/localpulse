// LocalPulse — real-world hazard awareness. All free, no API key.
//   - Open-Meteo: live weather + 2-day forecast -> derived warnings (rain, snow,
//     storm, heat, cold, wind). https://open-meteo.com (free, no key).
//   - USGS: recent earthquakes near the town (Himachal is a high-seismic zone).
//   - NDMA Sachet: official Indian government CAP alerts (IMD/SDMA), filtered to
//     the region. https://sachet.ndma.gov.in
// Each fetch is timeout-bounded and degrades to null/[] so one bad feed never
// breaks the others.

const { BASE } = require('../data/incidents');

// Himachal-distinctive terms only — bare names shared with other states
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

  if (maxPrecip >= 50) warnings.push({ level: 'high', kind: 'flood', text: `Heavy rain expected (${Math.round(maxPrecip)} mm). Flash-flood / landslide risk — avoid riverbeds and slopes.` });
  else if (maxPrecip >= 20) warnings.push({ level: 'medium', kind: 'rain', text: `Significant rain expected (${Math.round(maxPrecip)} mm). Roads may be slippery; landslide-prone stretches at risk.` });
  if (codes.some((x) => (x >= 71 && x <= 77) || (x >= 85 && x <= 86))) warnings.push({ level: 'medium', kind: 'snow', text: 'Snowfall likely — roads may close, power lines at risk. Keep warm supplies.' });
  if (codes.some((x) => x >= 95)) warnings.push({ level: 'medium', kind: 'storm', text: 'Thunderstorm likely — stay indoors, avoid open areas and trees.' });
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
  const [weather, quakes, alerts] = await Promise.all([fetchWeather(), fetchQuakes(), fetchOfficialAlerts()]);
  return { weather, quakes, alerts, ts: Date.now() };
}

module.exports = { fetchHazards, fetchWeather, fetchQuakes, fetchOfficialAlerts };
