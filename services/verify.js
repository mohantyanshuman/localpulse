// LocalPulse — agentic verification of citizen reports.
// When a resident submits a report, a Gemini model with the Google Search tool
// (real agentic web search) cross-checks it against current news and official
// sources and returns a verdict (corroborated / unverified / contradicted) with
// a confidence and a short note. This closed loop — citizen report → agentic
// corroboration → trust verdict → escalation — is what makes the feed
// trustworthy in a rumour-heavy crisis. A daily cap protects the model budget.

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const DAILY_CAP = Number(process.env.VERIFY_DAILY_CAP || 60);
let day = '';
let count = 0;

function budgetOk() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; count = 0; }
  return count < DAILY_CAP;
}

function extractJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Returns { verdict, severity, confidence, note } or null.
async function verifyReport(report) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !report || !report.message) return null;
  if (!budgetOk()) return null;
  count += 1;
  const region = process.env.LOCATION_QUERY || 'Solan, Himachal Pradesh';
  const prompt = [
    `A resident of ${region}, India submitted this emergency report:`,
    `"${report.message}" (category: ${report.category}).`,
    'Use web search to check current news and official sources for corroboration.',
    'Return ONLY JSON: {"verdict":"corroborated|unverified|contradicted","severity":"high|medium|low","confidence":<0-1>,"note":"<one short factual sentence on what sources show>"}'
  ].join(' ');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = { contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const out = extractJson(text);
    if (!out) return null;
    const verdict = ['corroborated', 'unverified', 'contradicted'].includes(out.verdict) ? out.verdict : 'unverified';
    const severity = ['high', 'medium', 'low'].includes(out.severity) ? out.severity : 'low';
    const confidence = typeof out.confidence === 'number' ? Math.max(0, Math.min(1, out.confidence)) : 0.5;
    return { verdict, severity, confidence, note: String(out.note || '').slice(0, 200) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { verifyReport };
