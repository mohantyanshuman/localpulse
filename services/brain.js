// LocalPulse: the triage "brain". Turns raw posts into structured incidents:
// relevance, category, severity, REAL coordinates, and content in all five
// supported languages, plus an overall multilingual status summary.
//
// Two modes, chosen automatically:
//   - LLM mode  : GEMINI_API_KEY set -> one batched Gemini call does everything.
//   - Heuristic : no key -> keyword rules classify real fetched items for free
//                 (English only, approximate location). Lower quality, ₹0.

// Auto-updating alias: always the latest Flash-Lite (cheapest/fastest tier),
// so new model generations are picked up without a code change.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const LANGS = ['en', 'hi', 'pa', 'ta', 'bn'];
const CATEGORIES = ['road', 'shelter', 'power', 'water', 'medical', 'rumor'];
const SEVERITIES = ['high', 'medium', 'low', 'info'];
const MAX_LLM_ITEMS = Number(process.env.LLM_MAX_ITEMS || 12); // bound output tokens

function hasLLM() {
  return !!process.env.GEMINI_API_KEY;
}

// Rough India bounding box; reject hallucinated coordinates outside it.
function validCoord(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
    lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98;
}

async function geminiJson(prompt, ms = 45000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 32768 }
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) {
      process.stderr.write(JSON.stringify({ severity: 'WARNING', kind: 'gemini', http: r.status }) + '\n');
      return null;
    }
    const j = await r.json();
    const cand = j.candidates?.[0];
    const txt = cand?.content?.parts?.[0]?.text || '';
    try {
      return JSON.parse(txt);
    } catch {
      // Truncated/!STOP responses (e.g. MAX_TOKENS) yield invalid JSON; salvage it.
      const salvaged = salvageJson(txt);
      if (!salvaged) {
        process.stderr.write(JSON.stringify({ severity: 'WARNING', kind: 'gemini-parse', finishReason: cand?.finishReason, len: txt.length }) + '\n');
      }
      return salvaged;
    }
  } catch (e) {
    process.stderr.write(JSON.stringify({ severity: 'WARNING', kind: 'gemini-fetch', msg: e.message }) + '\n');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Best-effort recovery of a truncated JSON object: close any open string and
// trim to the last complete top-level "items" entry so a partial batch is still
// usable rather than discarded entirely.
function salvageJson(txt) {
  if (!txt || txt[0] !== '{') return null;
  const lastComplete = txt.lastIndexOf('}\n  ]'); // unlikely; fall through to brace-balance
  for (let end = txt.length; end > 0; end--) {
    const slice = txt.slice(0, end);
    const opens = (slice.match(/{/g) || []).length;
    const closes = (slice.match(/}/g) || []).length;
    if (opens === closes && closes > 0) {
      try { return JSON.parse(slice); } catch { /* keep shrinking */ }
    }
  }
  void lastComplete;
  return null;
}

const KW = {
  rumor: ['rumour', 'rumor', 'fake news', 'hoax', 'false claim', 'misinformation', 'debunk', 'fact check'],
  medical: ['hospital', 'ambulance', 'injured', 'doctor', 'medical', 'health', 'dengue', 'outbreak', 'casualt', 'killed', 'dead'],
  road: ['road', 'highway', 'nh-', 'nh ', 'blocked', 'traffic', 'landslide', 'diversion', 'accident', 'bridge'],
  power: ['power', 'electricity', 'outage', 'blackout', 'hpsebl', 'transformer', 'power cut'],
  water: ['water', 'tanker', 'flood', 'drinking water', 'water supply', 'reservoir', 'dam'],
  shelter: ['shelter', 'relief camp', 'rescue', 'evacuat', 'stranded', 'rehabilitat']
};

function heuristicCategory(text) {
  const t = text.toLowerCase();
  for (const c of ['rumor', 'medical', 'road', 'power', 'water', 'shelter']) {
    if (KW[c].some((k) => t.includes(k))) return c;
  }
  return null;
}
function heuristicSeverity(text) {
  const t = text.toLowerCase();
  if (/(dead|death|killed|critical|severe|major|trapped|washed away|cloudburst|emergency)/.test(t)) return 'high';
  if (/(injured|blocked|outage|cut|disrupt|warning|alert|evacuat|landslide)/.test(t)) return 'medium';
  return 'low';
}
function clean(title) {
  return String(title).replace(/\s+-\s+[^-]+$/, '').slice(0, 90).trim();
}
const langObj = (en) => LANGS.reduce((o, l) => ((o[l] = en), o), {}); // en in every slot (fallback)

function heuristicClassify(items) {
  const out = [];
  for (const it of items) {
    const cat = heuristicCategory(`${it.title} ${it.text}`);
    if (!cat) continue;
    const title = clean(it.title);
    const summary = (it.text || it.title).slice(0, 160);
    out.push({ ...it, category: cat, severity: cat === 'rumor' ? 'low' : heuristicSeverity(`${it.title} ${it.text}`), titleI18n: langObj(title), summaryI18n: langObj(summary) });
  }
  const counts = {};
  out.forEach((x) => { counts[x.category] = (counts[x.category] || 0) + 1; });
  const enBullets = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c} ${n > 1 ? 'reports' : 'report'} in the last scan.`);
  return { items: out, bullets: langObj(enBullets) };
}

// Phase 1: fast, reliable ENGLISH-ONLY classification + geocoding. Small output,
// so it doesn't truncate or time out; this is the critical path.
async function llmClassify(items) {
  const compact = items.slice(0, MAX_LLM_ITEMS).map((it, i) => ({ i, source: it.source, title: it.title, text: (it.text || '').slice(0, 240) }));
  const region = process.env.LOCATION_QUERY || 'Solan, Himachal Pradesh';
  const prompt = [
    `You are an emergency-information triage system for ${region}, India.`,
    'For each public post/news item, decide if it is a local emergency or civic disruption. Return STRICT JSON only:',
    '{"items":[{"i":<index>,"relevant":<bool>,"category":"road|shelter|power|water|medical|rumor","severity":"high|medium|low|info","lat":<number>,"lng":<number>,"place":"<place>","title":"<factual en title <=80 chars>","summary":"<one factual en sentence>"}],"bullets":["<=6 short en status bullets"]}',
    '- relevant=false for anything not a local emergency/civic disruption. category=rumor when debunking/unverified.',
    '- lat/lng: decimal coordinates of the specific place named (use your geographic knowledge); if unknown use the region centre.',
    `INPUT: ${JSON.stringify(compact)}`
  ].join('\n');

  const j = await geminiJson(prompt, 30000);
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
      severity: SEVERITIES.includes(r.severity) ? r.severity : 'low',
      lat: validCoord(r.lat, r.lng) ? r.lat : undefined,
      lng: validCoord(r.lat, r.lng) ? r.lng : undefined,
      place: typeof r.place === 'string' ? r.place : undefined,
      titleI18n: langObj(clean(r.title || base.title)),
      summaryI18n: langObj((r.summary || base.text || base.title).slice(0, 200))
    });
  }
  const bullets = langObj(Array.isArray(j.bullets) ? j.bullets.filter((b) => typeof b === 'string').slice(0, 6) : []);
  return { items: out, bullets };
}

// Phase 2: best-effort translation of the kept en strings into hi/pa/ta/bn.
// Small input, so fast and reliable; on any failure the en text remains.
async function llmTranslate(result) {
  const targets = LANGS.filter((l) => l !== 'en');
  const strings = [];
  result.items.forEach((it) => { strings.push(it.titleI18n.en, it.summaryI18n.en); });
  result.bullets.en.forEach((b) => strings.push(b));
  if (!strings.length) return result;
  const prompt = [
    'Translate each English string into Hindi(hi), Punjabi(pa), Tamil(ta), Bengali(bn). Keep the same order and count.',
    'Return STRICT JSON {"hi":["..."],"pa":["..."],"ta":["..."],"bn":["..."]}: each array exactly the input length.',
    `INPUT (${strings.length} strings): ${JSON.stringify(strings)}`
  ].join('\n');
  const j = await geminiJson(prompt, 35000);
  if (!j) return result;
  for (const l of targets) {
    const arr = Array.isArray(j[l]) ? j[l] : null;
    if (!arr || arr.length < strings.length) continue;
    let k = 0;
    result.items.forEach((it) => { if (arr[k]) it.titleI18n[l] = arr[k]; k++; if (arr[k]) it.summaryI18n[l] = arr[k]; k++; });
    result.bullets[l] = result.bullets.en.map((_, bi) => arr[k + bi] || result.bullets.en[bi]);
  }
  return result;
}

// Returns { items:[...{titleI18n, summaryI18n, lat?, lng?}], bullets:{lang:[...]} }.
// useLLM=false forces the free heuristic even when a key is set (used by the
// cold-start warm-up so it never makes a paid call).
async function classifyBatch(items, useLLM = true) {
  if (!items.length) return { items: [], bullets: langObj([]) };
  if (useLLM && hasLLM()) {
    const llm = await llmClassify(items); // phase 1 (en), reliable
    if (llm && llm.items.length) {
      try { return await llmTranslate(llm); } catch { return llm; } // phase 2 (translate), best-effort
    }
  }
  return heuristicClassify(items);
}

// Free-form question answering for the voice bot, grounded in live data.
// Returns a short spoken answer string, or null if the LLM is unavailable.
async function answerQuestion(question, lang, context) {
  if (!hasLLM() || !question) return null;
  const langName = { en: 'English', hi: 'Hindi', pa: 'Punjabi', ta: 'Tamil', bn: 'Bengali' }[lang] || 'English';
  const prompt = [
    `You are LocalPulse, a calm emergency helpline assistant for ${process.env.LOCATION_QUERY || 'Solan, Himachal Pradesh'}.`,
    `Answer the caller in ${langName}, in 1-2 short spoken sentences. Be factual and reassuring. If life-threatening, tell them to call 112 immediately.`,
    'Use ONLY the live data below; if it does not cover the question, say you do not have a confirmed update and suggest calling 112 or the local control room.',
    `LIVE DATA (JSON): ${JSON.stringify(context).slice(0, 4000)}`,
    `CALLER: ${question}`,
    'Return STRICT JSON: {"answer":"<spoken reply>"}'
  ].join('\n');
  const j = await geminiJson(prompt, 12000);
  return j && typeof j.answer === 'string' ? j.answer.trim() : null;
}

module.exports = { classifyBatch, answerQuestion, hasLLM };
