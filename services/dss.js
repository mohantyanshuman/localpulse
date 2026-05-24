// LocalPulse — Decision Support brain (spatially honest).
//
// A town is large: an incident in one corner must not blanket-scare the whole
// town or be presented as town-wide risk. So we separate two kinds of signal:
//   - AREA-WIDE hazards (weather warnings, official IMD/NDMA alerts, big quakes)
//     legitimately affect everyone in the district -> they drive the shared level.
//   - LOCALIZED incidents (a fire, an accident, a local outage) -> shown with
//     distance; they only raise YOUR risk if they are near YOU.
// We also exclude rumours and agentically-contradicted / low-trust reports from
// the risk score, so debunked claims never scare anyone. Rule-based and
// explainable: a DSS must justify its advice.

const health = require('./health');

const LEVELS = ['ok', 'elevated', 'high', 'severe'];

function titleOf(i, lang = 'en') {
  if (!i.title) return '';
  return (typeof i.title === 'string') ? i.title : (i.title[lang] || i.title.en || '');
}
function cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

function haversineKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return null;
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// opts.userLoc = { lat, lng } for a personalized assessment; omit for district view.
function assess(incidents = [], hazards = {}, facilities = [], opts = {}) {
  const userLoc = (opts.userLoc && typeof opts.userLoc.lat === 'number' && typeof opts.userLoc.lng === 'number') ? opts.userLoc : null;
  const R = Number(process.env.LOCAL_RADIUS_KM || 7);
  const sevRank = { high: 3, medium: 2, low: 1, info: 0 };
  const recs = [];
  const factors = [];

  // Genuine incidents only: drop rumours, contradicted reports, and very low trust.
  const genuine = incidents.filter((i) =>
    i.category !== 'rumor' && i.status !== 'contradicted' && (typeof i.trust !== 'number' || i.trust >= 0.3));

  // ---- Area-wide hazards (legitimately affect the whole district) ----
  let areaScore = 0;
  const w = hazards.weather;
  if (w && Array.isArray(w.warnings)) {
    for (const wn of w.warnings) { areaScore += wn.level === 'high' ? 4 : wn.level === 'medium' ? 2 : 1; recs.push({ kind: 'weather', level: wn.level, scope: 'area', text: wn.text }); }
    if (w.warnings.length) factors.push('district-wide weather warning');
  }
  const alerts = Array.isArray(hazards.alerts) ? hazards.alerts : [];
  if (alerts.length) { areaScore += Math.min(alerts.length * 3, 8); factors.push(`${alerts.length} official alert(s)`); }
  for (const a of alerts.slice(0, 3)) recs.push({ kind: 'official', level: 'high', scope: 'area', text: `Official (${a.authority || a.category}): ${a.title}`, link: a.link });
  const quakes = Array.isArray(hazards.quakes) ? hazards.quakes : [];
  const bigQuake = quakes.find((q) => q.mag >= 4);
  if (bigQuake) { areaScore += 3; factors.push(`earthquake M${bigQuake.mag}`); recs.push({ kind: 'quake', level: 'high', scope: 'area', text: `Earthquake M${bigQuake.mag} near ${bigQuake.place}. Check buildings for cracks.` }); }

  // ---- Incidents: scope to "near you" if location known, else the district ----
  // Time-decay: a one-time event (a fire that happened) must stop driving risk as
  // time passes. Contribution halves every RISK_HALF_LIFE_H hours and stale events
  // (older than RISK_STALE_H) drop out of "act now" advice entirely.
  const HALF_LIFE_H = Number(process.env.RISK_HALF_LIFE_H || 12);
  const STALE_H = Number(process.env.RISK_STALE_H || 36);
  const now = Date.now();
  const ageH = (i) => Math.max(0, (now - (i.updatedAt || now)) / 3600000);
  const recency = (i) => Math.pow(0.5, ageH(i) / HALF_LIFE_H); // 1.0 fresh → decays

  const withDist = genuine.map((i) => ({ i, km: userLoc ? haversineKm(userLoc, i) : null, age: ageH(i), w: recency(i) }));
  const scoped = userLoc ? withDist.filter((x) => x.km != null && x.km <= R) : withDist;
  const active = scoped.filter((x) => x.age <= STALE_H);
  const farCount = userLoc ? withDist.filter((x) => x.age <= STALE_H).length - active.length : 0;

  // Recency-weighted, distinct-category scoring (so 15 headlines about one fire,
  // or a fire from 3 days ago, don't read as a present emergency).
  const bestByCat = {};
  for (const x of scoped) {
    const contrib = (sevRank[x.i.severity] || 0) * x.w;
    if (!(x.i.category in bestByCat) || contrib > bestByCat[x.i.category]) bestByCat[x.i.category] = contrib;
  }
  let incidentScore = Object.values(bestByCat).reduce((s, v) => s + v, 0);
  if (!userLoc) incidentScore = Math.min(incidentScore, 6);

  // Advice only from CURRENT, serious incidents (recent + not faded), freshest first.
  const serious = scoped
    .filter((x) => (x.i.severity === 'high' || x.i.severity === 'medium') && x.age <= STALE_H && x.w >= 0.25)
    .sort((a, b) => (b.w - a.w) || ((a.km == null ? 1e9 : a.km) - (b.km == null ? 1e9 : b.km)))
    .slice(0, 3);
  for (const x of serious) {
    const where = x.km != null ? ` (~${x.km < 1 ? '<1' : Math.round(x.km)} km away)` : (x.i.place ? ` (${x.i.place})` : '');
    const ago = x.age < 1 ? 'just now' : x.age < 24 ? `${Math.round(x.age)}h ago` : `${Math.round(x.age / 24)}d ago`;
    recs.push({ kind: x.i.category, level: x.i.severity, scope: userLoc ? 'local' : 'district', text: `${cap(x.i.category)}: ${titleOf(x.i)}${where} — ${ago}.` });
  }

  // Nearby active natural events (NASA EONET: wildfires, storms) as area context.
  for (const ev of (Array.isArray(hazards.events) ? hazards.events : []).slice(0, 2)) {
    if (typeof ev.km === 'number' && ev.km <= 150) { areaScore += 1; recs.push({ kind: 'event', level: 'low', scope: 'area', text: `${ev.category}: ${ev.title} (~${ev.km} km).` }); }
  }
  // Helpful pointers (not alarming): nearest hospital for medical, relief points if area-wide.
  const hospitals = facilities.filter((f) => f.kind === 'hospital').slice(0, 2).map((f) => f.name + (f.phone ? ` (${f.phone})` : ''));
  if (serious.some((x) => x.i.category === 'medical') && hospitals.length) recs.push({ kind: 'medical', level: 'medium', text: `Nearest hospitals: ${hospitals.join('; ')}. Call 112 for ambulance.` });

  const score = areaScore + incidentScore;
  let level = 'ok';
  if (score >= 13) level = 'severe'; else if (score >= 7) level = 'high'; else if (score >= 3) level = 'elevated';
  const areaWide = areaScore >= 7 || (!!w && w.warnings.some((x) => x.level === 'high')) || alerts.length > 0 || !!bigQuake;

  // Honest, non-alarmist headline — counts only CURRENT (recent) incidents.
  const activeN = active.length;
  let headline;
  if (userLoc) {
    if (activeN === 0 && areaScore < 3) headline = 'All clear in your area right now. Stay aware.';
    else if (areaWide) headline = `A district-wide hazard is active. ${activeN} current incident(s) within ${R} km of you${farCount ? `, ${farCount} elsewhere` : ''}.`;
    else if (activeN === 0) headline = `No current incidents within ${R} km of you${farCount ? `; ${farCount} elsewhere in the district` : ''}.`;
    else headline = `${activeN} current incident(s) within ${R} km of you${farCount ? `; ${farCount} more elsewhere` : ''}.`;
  } else {
    if (activeN === 0 && areaScore < 3) headline = 'No major hazards across the district right now.';
    else if (areaWide) headline = `A district-wide hazard is active. ${activeN} current incident(s) across the district.`;
    else if (activeN === 0) headline = 'No current incidents — recent events have passed. Stay aware.';
    else headline = `${activeN} current incident(s) across the district — most are localized. Use "near me" for risk at your location.`;
  }

  // ---- Cross-source early-warning: a fresh event that many INDEPENDENT feeds are
  // already reporting is "emerging" — surfaced before any single official
  // confirmation. This is the value of fusing 40+ sources: corroboration velocity.
  const emerging = scoped
    .filter((x) => x.age <= 6 && (x.i.sources || 0) >= 2 && x.i.category !== 'rumor')
    .sort((a, b) => (b.i.sources || 0) - (a.i.sources || 0))
    .slice(0, 2)
    .map((x) => ({ category: x.i.category, title: titleOf(x.i), sources: x.i.sources, place: x.i.place }));
  for (const e of emerging) recs.push({ kind: 'emerging', level: 'medium', scope: 'area', text: `Emerging: ${e.title} — corroborated by ${e.sources} independent sources in the last hours.` });

  // ---- Predictive nowcast (next 24-48h): forward-looking guidance, NOT added to
  // the current risk score (we don't scare people about a future that may not
  // happen). Derived from forecast rain on hill terrain + river-discharge trend.
  let forecast = null;
  if (w) {
    const rainSoon = Math.max(w.precipTodayMm || 0, w.precipTomorrowMm || 0);
    const fl = hazards.flood;
    const floodRising = fl && typeof fl.dischargeMax === 'number' && fl.dischargeMax > Math.max(fl.dischargeNow || 0, 0.5) * 2 && fl.dischargeMax > 1;
    if (rainSoon >= 50 || floodRising) forecast = { trend: 'rising', horizon: '24-48h', text: `Heavy rain (~${Math.round(rainSoon)} mm) forecast on hill terrain — landslide and flash-flood risk rising. Avoid slopes and riverbeds; keep water, a torch and a power bank ready.` };
    else if (rainSoon >= 20) forecast = { trend: 'watch', horizon: '24-48h', text: `Moderate rain (~${Math.round(rainSoon)} mm) expected — local landslides or road slips possible. Plan travel accordingly.` };
    else forecast = { trend: 'stable', horizon: '24-48h', text: 'No major weather hazard expected over the next two days.' };
    if (forecast.trend !== 'stable') recs.push({ kind: 'forecast', level: forecast.trend === 'rising' ? 'high' : 'medium', scope: 'forecast', text: `Next 48h: ${forecast.text}` });
  }

  // ---- Post-disaster syndromic early-warning (water/vector-borne outbreaks).
  const outbreaks = health.detectOutbreaks(genuine);
  for (const o of outbreaks) recs.push({ kind: 'health', level: 'medium', scope: 'area', text: `Possible ${o.syndrome} cluster: ${o.count} reports in recent days. Authorities should check water/sanitation. Boil drinking water as a precaution.` });

  if (!recs.length) recs.push({ kind: 'info', level: 'low', text: 'No active hazards. Save 112 for emergencies and keep essentials ready.' });

  return {
    level,
    levelIndex: LEVELS.indexOf(level),
    score,
    areaScore,
    incidentScore,
    areaWide,
    headline,
    scope: userLoc ? 'local' : 'district',
    radiusKm: R,
    nearby: userLoc ? active.length : null,
    districtCount: active.length,
    tracked: genuine.length,
    farCount,
    factors,
    weather: w ? { tempC: w.tempC, condition: w.condition, precipTodayMm: w.precipTodayMm, precipTomorrowMm: w.precipTomorrowMm, aqi: hazards.airQuality ? hazards.airQuality.aqi : undefined } : null,
    forecast,
    emerging,
    outbreaks,
    officialAlerts: alerts.length,
    recommendations: recs.slice(0, 8),
    generatedAt: Date.now()
  };
}

const EO_RANK = { ok: 0, elevated: 1, high: 2, severe: 3 };

// Fold a satellite EOAssessment into a DSS result: take the higher level, add a
// recommendation per elevated satellite axis (same { kind, level, scope, text }
// shape as the rest of recommendations), and attach a compact satellite summary.
function mergeEo(assessment, eo) {
  if (!eo || !Array.isArray(eo.perHazard)) return assessment;
  const out = { ...assessment, recommendations: [...(assessment.recommendations || [])] };
  if (EO_RANK[eo.level] > EO_RANK[out.level || 'ok']) out.level = eo.level;
  for (const h of eo.perHazard) {
    if (EO_RANK[h.level] >= EO_RANK.high) {
      out.recommendations.push({
        kind: 'satellite',
        level: h.level,
        scope: 'area',
        text: `Satellite ${h.axis} signal is ${h.level} (${(h.sensorsUsed || []).join(', ')}).`,
      });
    }
  }
  out.satellite = {
    level: eo.level,
    sensorsUsed: eo.sensorsUsed || [],
    axes: eo.perHazard.map((h) => ({ axis: h.axis, level: h.level, confidence: h.confidence })),
  };
  return out;
}

module.exports = { assess, LEVELS, haversineKm, mergeEo };
