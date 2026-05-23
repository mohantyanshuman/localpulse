// LocalPulse — the triage "brain". Classifies raw posts into incident
// categories + severity and writes a short status summary.
//
// Two modes, chosen automatically:
//   - LLM mode  : when GEMINI_API_KEY is set, one batched Gemini call does
//                 relevance filtering, categorisation, severity, clean titles,
//                 one-line summaries, and overall bullets. ~1 call per ingest.
//   - Heuristic : with no key, keyword rules classify real fetched items for
//                 free. Lower quality, zero cost, still real data.

// Auto-updating alias: always the latest Flash-Lite (cheapest/fastest tier),
// so new model generations are picked up without a code change.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const CATEGORIES = ['road', 'shelter', 'power', 'water', 'medical', 'rumor'];

function hasLLM() {
  return !!process.env.GEMINI_API_KEY;
}

async function geminiJson(prompt, ms = 15000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
    return txt ? JSON.parse(txt) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const KW = {
  rumor: ['rumour', 'rumor', 'fake news', 'hoax', 'false claim', 'misinformation', 'debunk', 'fact check'],
  medical: ['hospital', 'ambulance', 'injured', 'doctor', 'medical', 'health', 'dengue', 'outbreak', 'casualt'],
  road: ['road', 'highway', 'nh-', 'nh ', 'blocked', 'traffic', 'landslide', 'diversion', 'accident', 'bridge'],
  power: ['power', 'electricity', 'outage', 'blackout', 'hpsebl', 'transformer', 'power cut'],
  water: ['water', 'tanker', 'flood', 'drinking water', 'water supply', 'reservoir', 'dam'],
  shelter: ['shelter', 'relief camp', 'rescue', 'evacuat', 'stranded', 'rehabilitat']
};

function heuristicCategory(text) {
  const t = text.toLowerCase();
  // rumor first (debunks), then most acute categories.
  for (const c of ['rumor', 'medical', 'road', 'power', 'water', 'shelter']) {
    if (KW[c].some((k) => t.includes(k))) return c;
  }
  return null; // not clearly an emergency/civic item -> dropped
}

function heuristicSeverity(text) {
  const t = text.toLowerCase();
  if (/(dead|death|killed|critical|severe|major|trapped|washed away|cloudburst|emergency)/.test(t)) return 'high';
  if (/(injured|blocked|outage|cut|disrupt|warning|alert|evacuat|landslide)/.test(t)) return 'medium';
  return 'low';
}

function clean(title) {
  // Google News appends " - Publisher"; drop the trailing source for a tidy title.
  return String(title).replace(/\s+-\s+[^-]+$/, '').slice(0, 90).trim();
}

function heuristicClassify(items) {
  const out = [];
  for (const it of items) {
    const cat = heuristicCategory(`${it.title} ${it.text}`);
    if (!cat) continue;
    out.push({
      ...it,
      category: cat,
      severity: cat === 'rumor' ? 'low' : heuristicSeverity(`${it.title} ${it.text}`),
      cleanTitle: clean(it.title),
      summary: (it.text || it.title).slice(0, 160)
    });
  }
  const counts = {};
  out.forEach((x) => { counts[x.category] = (counts[x.category] || 0) + 1; });
  const bullets = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${n} ${c} ${n > 1 ? 'reports' : 'report'} in the last scan.`);
  return { items: out, bullets };
}

async function llmClassify(items) {
  const compact = items.map((it, i) => ({ i, source: it.source, title: it.title, text: (it.text || '').slice(0, 280) }));
  const prompt = [
    `You are an emergency-information triage system for ${process.env.LOCATION_QUERY || 'Solan, Himachal Pradesh'}, India.`,
    'Classify each public post/news item below. Return STRICT JSON only:',
    '{"items":[{"i":<index>,"relevant":<bool>,"category":"road|shelter|power|water|medical|rumor","severity":"high|medium|low|info","title":"<factual en title <=80 chars>","summary":"<one factual en sentence>"}],"bullets":["<=6 short overall status bullets in en"]}',
    'relevant=false for anything not a local emergency or civic disruption. category=rumor when the item debunks or spreads an unverified claim. No clickbait; keep titles factual.',
    `INPUT: ${JSON.stringify(compact)}`
  ].join('\n');

  const j = await geminiJson(prompt);
  if (!j || !Array.isArray(j.items)) return null;

  const out = [];
  for (const r of j.items) {
    if (!r || r.relevant === false) continue;
    const base = items[r.i];
    if (!base) continue;
    const category = CATEGORIES.includes(r.category) ? r.category : heuristicCategory(`${base.title} ${base.text}`);
    if (!category) continue;
    out.push({
      ...base,
      category,
      severity: ['high', 'medium', 'low', 'info'].includes(r.severity) ? r.severity : 'low',
      cleanTitle: clean(r.title || base.title),
      summary: (r.summary || base.text || base.title).slice(0, 200)
    });
  }
  const bullets = Array.isArray(j.bullets) ? j.bullets.filter((b) => typeof b === 'string').slice(0, 6) : [];
  return { items: out, bullets };
}

// Returns { items: [...classified...], bullets: [...] }. Falls back to heuristic
// if the LLM is absent or returns nothing usable.
async function classifyBatch(items) {
  if (!items.length) return { items: [], bullets: [] };
  if (hasLLM()) {
    const llm = await llmClassify(items);
    if (llm && llm.items.length) return llm;
  }
  return heuristicClassify(items);
}

module.exports = { classifyBatch, hasLLM };
