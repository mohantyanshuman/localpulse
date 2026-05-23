// LocalPulse — post-disaster syndromic early-warning.
// After floods/quakes, secondary disease outbreaks (water-borne, vector-borne)
// often cause more harm than the event itself. This scans recent community
// reports + news incidents for clusters of symptom mentions and raises an early,
// clearly-hedged public-health signal so authorities can check water/sanitation
// before it becomes an epidemic. Rule-based, free, explainable.

const SYNDROMES = {
  'water-borne (gastro)': ['diarrhea', 'diarrhoea', 'loose motion', 'vomit', 'cholera', 'typhoid', 'dehydration', 'jaundice', 'hepatitis', 'gastro'],
  'vector-borne / fever': ['dengue', 'malaria', 'chikungunya', 'high fever', ' fever', 'rash'],
  respiratory: ['influenza', ' flu ', 'cough', 'breathless', 'pneumonia', 'respiratory illness'],
  'skin / wound': ['skin infection', 'wound infection', 'sepsis', 'fungal']
};

function textOf(i) {
  const t = i.title ? (typeof i.title === 'string' ? i.title : (i.title.en || '')) : '';
  const s = i.summary ? (typeof i.summary === 'string' ? i.summary : (i.summary.en || '')) : (i.message || '');
  return `${t} ${s}`.toLowerCase();
}

// items: merged incidents + community reports (each with updatedAt). Returns
// [{ syndrome, count, sample }] for syndromes crossing the cluster threshold.
function detectOutbreaks(items, opts = {}) {
  const min = Number(opts.min || process.env.OUTBREAK_MIN || 3);
  const windowH = Number(opts.windowH || process.env.OUTBREAK_WINDOW_H || 72);
  const now = Date.now();
  const recent = items.filter((i) => (now - (i.updatedAt || i.createdAt || now)) <= windowH * 3.6e6);
  const out = [];
  for (const [syndrome, kws] of Object.entries(SYNDROMES)) {
    const hits = recent.filter((i) => { const t = textOf(i); return kws.some((k) => t.includes(k)); });
    if (hits.length >= min) {
      out.push({ syndrome, count: hits.length, sample: (hits[0].title && (hits[0].title.en || hits[0].title)) || hits[0].message || '' });
    }
  }
  return out;
}

module.exports = { detectOutbreaks };
