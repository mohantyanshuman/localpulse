// LocalPulse: conversational situational assistant (RAG over live data).
// A resident asks a free-form question ("Is the road to Shimla safe tonight?",
// "Where can my elderly mother get insulin?") and a Gemini model answers using
// ONLY the live fused situational context (incidents + hazards + forecast +
// facilities + the personalized risk assessment). Unlike the intent voice bot,
// this is open-ended decision support grounded in real-time multi-source data.
// Daily-capped to protect the model budget.

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const DAILY_CAP = Number(process.env.ASK_DAILY_CAP || 300);
let day = '';
let count = 0;
function budgetOk() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; count = 0; }
  return count < DAILY_CAP;
}

const LANG_NAME = { en: 'English', hi: 'Hindi', pa: 'Punjabi', ta: 'Tamil', bn: 'Bengali' };

async function ask(question, context, lang = 'en') {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !question) return null;
  if (!budgetOk()) return { answer: 'The assistant is busy right now. Please read the live status above, or call 112 for emergencies.' };
  count += 1;
  const prompt = [
    `You are LocalPulse, a calm, factual crisis-support assistant for ${process.env.LOCATION_QUERY || 'Solan, Himachal Pradesh'}, India.`,
    `Answer the resident in ${LANG_NAME[lang] || 'English'}, in 2-4 short, plain sentences, using ONLY the live situational data below.`,
    'Do NOT invent incidents or facilities. If the data does not cover the question, say so honestly and suggest calling 112 or the local control room. If the question implies a life-threatening emergency, tell them to call 112 first. Be reassuring, not alarming; if there is no current hazard, say it is calm.',
    `LIVE SITUATIONAL DATA (JSON): ${JSON.stringify(context).slice(0, 6000)}`,
    `QUESTION: ${question}`,
    'Return STRICT JSON: {"answer":"<your reply>"}'
  ].join('\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 1024 } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) return null;
    const out = JSON.parse(txt);
    return { answer: String(out.answer || '').slice(0, 800) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ask };
