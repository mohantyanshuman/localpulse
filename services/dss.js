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
  const withDist = genuine.map((i) => ({ i, km: userLoc ? haversineKm(userLoc, i) : null }));
  const scoped = userLoc ? withDist.filter((x) => x.km != null && x.km <= R) : withDist;
  const farCount = userLoc ? withDist.length - scoped.length : 0;

  // Distinct category-severity scoring (so 15 headlines about one fire != 15
  // emergencies). District view is capped so one corner can't read as severe.
  const worstByCat = {};
  for (const x of scoped) { const c = x.i.category; if (!worstByCat[c] || sevRank[x.i.severity] > sevRank[worstByCat[c]]) worstByCat[c] = x.i.severity; }
  let incidentScore = Object.values(worstByCat).reduce((s, sev) => s + (sevRank[sev] || 0), 0);
  if (!userLoc) incidentScore = Math.min(incidentScore, 6);

  // Targeted advice from the nearest serious incidents, with distance if known.
  const serious = scoped.filter((x) => x.i.severity === 'high' || x.i.severity === 'medium')
    .sort((a, b) => (a.km == null ? 1e9 : a.km) - (b.km == null ? 1e9 : b.km)).slice(0, 3);
  for (const x of serious) {
    const where = x.km != null ? ` (~${x.km < 1 ? '<1' : Math.round(x.km)} km away)` : (x.i.place ? ` (${x.i.place})` : '');
    recs.push({ kind: x.i.category, level: x.i.severity, scope: userLoc ? 'local' : 'district', text: `${cap(x.i.category)}: ${titleOf(x.i)}${where}.` });
  }
  // Helpful pointers (not alarming): nearest hospital for medical, relief points if area-wide.
  const hospitals = facilities.filter((f) => f.kind === 'hospital').slice(0, 2).map((f) => f.name + (f.phone ? ` (${f.phone})` : ''));
  if (serious.some((x) => x.i.category === 'medical') && hospitals.length) recs.push({ kind: 'medical', level: 'medium', text: `Nearest hospitals: ${hospitals.join('; ')}. Call 112 for ambulance.` });

  const score = areaScore + incidentScore;
  let level = 'ok';
  if (score >= 13) level = 'severe'; else if (score >= 7) level = 'high'; else if (score >= 3) level = 'elevated';
  const areaWide = areaScore >= 7 || (!!w && w.warnings.some((x) => x.level === 'high')) || alerts.length > 0 || !!bigQuake;

  // Honest, non-alarmist headline.
  let headline;
  if (userLoc) {
    if (scoped.length === 0 && areaScore < 3) headline = 'All clear in your area right now. Stay aware.';
    else if (areaWide) headline = `A district-wide hazard is active. ${scoped.length} incident(s) within ${R} km of you${farCount ? `, ${farCount} elsewhere` : ''}.`;
    else headline = `${scoped.length} incident(s) within ${R} km of you${farCount ? `; ${farCount} more elsewhere in the district` : ''}.`;
  } else {
    const total = genuine.length;
    if (total === 0 && areaScore < 3) headline = 'No major hazards across the district right now.';
    else if (areaWide) headline = `A district-wide hazard is active. ${total} incident(s) being tracked across the district.`;
    else headline = `${total} active incident(s) across the district — most are localized. Use "near me" for risk at your location.`;
  }

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
    nearby: userLoc ? scoped.length : null,
    districtCount: genuine.length,
    farCount,
    factors,
    weather: w ? { tempC: w.tempC, condition: w.condition, precipTodayMm: w.precipTodayMm, precipTomorrowMm: w.precipTomorrowMm } : null,
    officialAlerts: alerts.length,
    recommendations: recs.slice(0, 8),
    generatedAt: Date.now()
  };
}

module.exports = { assess, LEVELS, haversineKm };
