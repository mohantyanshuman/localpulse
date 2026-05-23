// LocalPulse — real public data sources. Dependency-free (Node 20 global fetch).
//
// Google News RSS needs no API key and is reachable from cloud IPs, so the app
// ingests real data out of the box. Reddit is optional and only activates when
// REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET are present (free app-only OAuth).
// Every fetch is timeout-bounded and returns [] on any failure so a flaky source
// can never break ingestion.

const UA = 'LocalPulse/1.0 (+https://localpulse.dmj.one)';
const LOCATION = process.env.LOCATION_QUERY || 'Solan Himachal Pradesh';

function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
function stripTags(s) {
  return decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Minimal RSS <item> extractor — sufficient for well-formed feeds like Google News.
function parseRss(xml) {
  const out = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const block of blocks) {
    const seg = block.split(/<\/item>/i)[0];
    const pick = (tag) => {
      const m = seg.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? decode(m[1]).trim() : '';
    };
    const title = stripTags(pick('title'));
    if (!title) continue;
    out.push({ title, link: pick('link'), pubDate: pick('pubDate'), description: stripTags(pick('description')) });
  }
  return out;
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(timer);
  }
}

// Google News RSS search scoped to the town + emergency/civic terms. No key.
async function fetchGoogleNews() {
  const terms = '(flood OR fire OR landslide OR "power cut" OR "road blocked" OR accident OR rescue OR shelter OR "water supply" OR storm OR "heavy rain" OR evacuation OR cloudburst)';
  const q = encodeURIComponent(`${LOCATION} ${terms}`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRss(xml).map((it) => ({
      source: 'google-news',
      official: false,
      title: it.title,
      text: it.description || it.title,
      url: it.link,
      publishedAt: it.pubDate ? Date.parse(it.pubDate) || Date.now() : Date.now()
    }));
  } catch {
    return [];
  }
}

// Reddit app-only OAuth (optional). Token cached until ~1 min before expiry.
let redditToken = { value: null, exp: 0 };
async function redditAuth() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken.value && Date.now() < redditToken.exp) return redditToken.value;
  try {
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const r = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    if (!r.ok) return null;
    const j = await r.json();
    redditToken = { value: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
    return redditToken.value;
  } catch {
    return null;
  }
}

async function fetchReddit() {
  const token = await redditAuth();
  if (!token) return [];
  const subs = process.env.REDDIT_SUBS || 'himachal,india';
  try {
    const r = await fetchWithTimeout(`https://oauth.reddit.com/r/${subs}/new?limit=25`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.data?.children || [])
      .map((c) => c.data)
      .filter(Boolean)
      .map((d) => ({
        source: 'reddit',
        official: false,
        title: d.title || '',
        text: (d.selftext || d.title || '').slice(0, 500),
        url: `https://www.reddit.com${d.permalink}`,
        publishedAt: (d.created_utc || 0) * 1000 || Date.now()
      }))
      .filter((x) => x.title);
  } catch {
    return [];
  }
}

// Fetch all sources in parallel; failures degrade to [].
async function fetchAll() {
  const results = await Promise.allSettled([fetchGoogleNews(), fetchReddit()]);
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

module.exports = { fetchAll, fetchGoogleNews, fetchReddit };
