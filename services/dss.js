// LocalPulse — Decision Support brain.
// Turns live incidents + real hazards (weather, quakes, official alerts) +
// facilities into a single town RISK LEVEL and a ranked list of ACTIONABLE
// recommendations. Rule-based and explainable on purpose: in a crisis, a DSS
// must justify its advice, not hide it behind a model.

const LEVELS = ['ok', 'elevated', 'high', 'severe'];

function titleOf(i, lang = 'en') {
  if (!i.title) return '';
  return (typeof i.title === 'string') ? i.title : (i.title[lang] || i.title.en || '');
}

function assess(incidents = [], hazards = {}, facilities = []) {
  let score = 0;
  const factors = [];
  const recs = [];

  const real = incidents.filter((i) => i.category !== 'rumor');
  const high = real.filter((i) => i.severity === 'high');
  const med = real.filter((i) => i.severity === 'medium');
  // Score by DISTINCT category-severity signals, not raw headline count: the same
  // event reported by 15 outlets must not look like 15 emergencies. Each category
  // contributes once, at its worst observed severity.
  const sevRank = { high: 3, medium: 2, low: 1, info: 0 };
  const worstByCat = {};
  for (const i of real) {
    if (!worstByCat[i.category] || sevRank[i.severity] > sevRank[worstByCat[i.category]]) worstByCat[i.category] = i.severity;
  }
  for (const sev of Object.values(worstByCat)) score += sevRank[sev] || 0;
  if (high.length) factors.push(`${Object.values(worstByCat).filter((s) => s === 'high').length} category(ies) at high severity`);

  const w = hazards.weather;
  if (w && Array.isArray(w.warnings)) {
    for (const wn of w.warnings) {
      score += wn.level === 'high' ? 4 : wn.level === 'medium' ? 2 : 1;
      recs.push({ kind: 'weather', level: wn.level, text: wn.text });
    }
    if (w.warnings.length) factors.push('active weather warning');
  }

  const alerts = Array.isArray(hazards.alerts) ? hazards.alerts : [];
  if (alerts.length) { score += Math.min(alerts.length * 2, 6); factors.push(`${alerts.length} official alert(s)`); }
  for (const a of alerts.slice(0, 3)) {
    recs.push({ kind: 'official', level: 'high', text: `Official (${a.authority || a.category}): ${a.title}`, link: a.link });
  }

  const quakes = Array.isArray(hazards.quakes) ? hazards.quakes : [];
  const bigQuake = quakes.find((q) => q.mag >= 4);
  if (bigQuake) { score += 3; factors.push(`earthquake M${bigQuake.mag}`); recs.push({ kind: 'quake', level: 'high', text: `Earthquake M${bigQuake.mag} near ${bigQuake.place}. Check buildings for cracks; be ready to move to open ground.` }); }

  // Targeted advice from the incidents themselves.
  for (const r of [...high, ...med].filter((i) => i.category === 'road').slice(0, 2)) {
    recs.push({ kind: 'road', level: r.severity, text: `Roads: ${titleOf(r)} — avoid the stretch and use a diversion.` });
  }
  const hospitals = facilities.filter((f) => f.kind === 'hospital').slice(0, 2).map((f) => f.name + (f.phone ? ` (${f.phone})` : ''));
  if (high.some((i) => i.category === 'medical') && hospitals.length) {
    recs.push({ kind: 'medical', level: 'high', text: `Medical emergencies reported. Nearest hospitals: ${hospitals.join('; ')}. Call 112 for ambulance.` });
  }
  if ((high.length || (w && w.warnings.some((x) => x.level === 'high'))) && facilities.length) {
    const relief = facilities.filter((f) => ['community_centre', 'school', 'shelter'].includes(f.kind)).slice(0, 2).map((f) => f.name);
    if (relief.length) recs.push({ kind: 'shelter', level: 'medium', text: `If you need to move, relief points: ${relief.join('; ')}.` });
  }

  let level = 'ok';
  if (score >= 13) level = 'severe';
  else if (score >= 7) level = 'high';
  else if (score >= 3) level = 'elevated';

  const headline = {
    ok: 'No major hazards right now. Stay aware and keep your phone charged.',
    elevated: 'Elevated risk. Monitor updates and avoid affected areas.',
    high: 'High risk. Follow advisories and avoid non-essential travel.',
    severe: 'Severe. Act on official instructions immediately; move to safety.'
  }[level];

  if (!recs.length) recs.push({ kind: 'info', level: 'low', text: 'No active hazards. Save 112 for emergencies and keep essentials ready.' });

  return {
    level,
    levelIndex: LEVELS.indexOf(level),
    score,
    headline,
    factors,
    weather: w ? { tempC: w.tempC, condition: w.condition, precipTodayMm: w.precipTodayMm, precipTomorrowMm: w.precipTomorrowMm } : null,
    officialAlerts: alerts.length,
    recommendations: recs.slice(0, 8),
    generatedAt: Date.now()
  };
}

module.exports = { assess, LEVELS };
