// LocalPulse: community mutual-aid matching.
// Residents post a NEED ("need drinking water for 3"), an OFFER ("have a 4x4,
// can ferry people from Chambaghat") or mark themselves SAFE. This engine
// auto-matches each open need to the nearest open offer in the same resource
// category, so neighbours help neighbours when official help is stretched.

const CATS = {
  water: ['water', 'tanker', 'drink'],
  food: ['food', 'meal', 'ration', 'milk', 'roti', 'langar'],
  shelter: ['shelter', 'stay', 'room', 'space', 'roof', 'place to'],
  transport: ['transport', 'vehicle', 'lift', 'car', 'jeep', '4x4', 'ferry', 'ride', 'ambulance'],
  medical: ['medic', 'medicine', 'doctor', 'insulin', 'oxygen', 'first aid', 'blood'],
  power: ['power', 'charge', 'battery', 'generator', 'electric'],
  rescue: ['rescue', 'trapped', 'stuck', 'stranded', 'evacuat']
};

function categoryOf(text) {
  const t = String(text || '').toLowerCase();
  for (const [c, kws] of Object.entries(CATS)) if (kws.some((k) => t.includes(k))) return c;
  return 'other';
}

function km(a, b) {
  if (typeof a.lat !== 'number' || typeof b.lat !== 'number') return null;
  const R = 6371, tr = (d) => d * Math.PI / 180;
  const dLat = tr(b.lat - a.lat), dLng = tr(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(a.lat)) * Math.cos(tr(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Annotate items with category, and attach the best matching offer to each need.
function enrich(items) {
  const withCat = items.map((x) => ({ ...x, cat: categoryOf(x.message) }));
  const offers = withCat.filter((x) => x.kind === 'offer');
  return withCat.map((x) => {
    if (x.kind !== 'need') return x;
    const cands = offers.filter((o) => o.cat === x.cat);
    let best = null, bestKm = Infinity;
    for (const o of cands) {
      const d = km(x, o);
      if (d == null) { if (!best) best = o; continue; }
      if (d < bestKm) { bestKm = d; best = o; }
    }
    if (best) x.match = { id: best.id, name: best.name || 'A neighbour', message: best.message, km: bestKm === Infinity ? null : Math.round(bestKm * 10) / 10 };
    return x;
  });
}

module.exports = { enrich, categoryOf };
