// LocalPulse — real public news/social sources. Dependency-free (Node 20 fetch).
// A broad registry of FREE, no-key feeds: Google News geo/topic queries scoped to
// Himachal districts + direct RSS from national and regional outlets (English +
// Hindi). Breadth matters for QUALITY: when many independent feeds report the same
// event, the dedup cluster is large and trust is high; lone-source noise stays low.
// Authoritative outlets are flagged so their corroboration counts as "verified".
// Every fetch is timeout-bounded and failures are skipped, so a dead feed never
// breaks ingestion.

const LOCATION = process.env.LOCATION_QUERY || 'Solan Himachal Pradesh';
const HAZARD = '(flood OR fire OR landslide OR "power cut" OR "road blocked" OR accident OR rescue OR shelter OR "water supply" OR storm OR "heavy rain" OR evacuation OR cloudburst OR earthquake OR "cloud burst")';
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
const gnewsHi = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=hi-IN&gl=IN&ceid=IN:hi`;

// 40+ distinct free sources.
const SOURCES = [
  // --- Google News, Himachal districts & towns (each a distinct coverage view)
  { name: 'gn-solan', url: gnews(`Solan ${HAZARD}`) },
  { name: 'gn-shimla', url: gnews(`Shimla ${HAZARD}`) },
  { name: 'gn-kasauli', url: gnews(`(Kasauli OR Parwanoo OR Kandaghat) ${HAZARD}`) },
  { name: 'gn-baddi', url: gnews(`(Nalagarh OR Baddi OR Arki) ${HAZARD}`) },
  { name: 'gn-sirmaur', url: gnews(`(Sirmaur OR Nahan OR Paonta) ${HAZARD}`) },
  { name: 'gn-kullu', url: gnews(`(Kullu OR Manali) ${HAZARD}`) },
  { name: 'gn-mandi', url: gnews(`Mandi Himachal ${HAZARD}`) },
  { name: 'gn-kangra', url: gnews(`(Kangra OR Dharamshala OR Palampur) ${HAZARD}`) },
  { name: 'gn-chamba', url: gnews(`(Chamba OR Dalhousie) Himachal ${HAZARD}`) },
  { name: 'gn-bilaspur', url: gnews(`Bilaspur Himachal ${HAZARD}`) },
  { name: 'gn-una', url: gnews(`(Una OR Hamirpur) Himachal ${HAZARD}`) },
  { name: 'gn-kinnaur', url: gnews(`(Kinnaur OR "Lahaul Spiti") ${HAZARD}`) },
  // --- Google News, Himachal hazard topics
  { name: 'gn-hp-landslide', url: gnews('Himachal Pradesh landslide') },
  { name: 'gn-hp-flood', url: gnews('Himachal Pradesh flood OR cloudburst') },
  { name: 'gn-hp-fire', url: gnews('Himachal Pradesh fire') },
  { name: 'gn-hp-weather', url: gnews('Himachal Pradesh weather warning OR rain alert') },
  { name: 'gn-hp-road', url: gnews('Himachal Pradesh road accident OR highway blocked') },
  { name: 'gn-hp-power', url: gnews('Himachal Pradesh power cut OR electricity') },
  { name: 'gn-hp-disaster', url: gnews('Himachal Pradesh disaster OR rescue OR evacuation') },
  { name: 'gn-hp-hindi', url: gnewsHi('हिमाचल प्रदेश आपदा OR भूस्खलन OR बाढ़ OR आग') },
  // --- Direct national outlet RSS (authoritative)
  { name: 'the-hindu', url: 'https://www.thehindu.com/news/national/feeder/default.rss', authority: true },
  { name: 'toi-top', url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', authority: true },
  { name: 'toi-india', url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', authority: true },
  { name: 'ht-india', url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml', authority: true },
  { name: 'indian-express', url: 'https://indianexpress.com/section/india/feed/', authority: true },
  { name: 'ndtv-india', url: 'https://feeds.feedburner.com/ndtvnews-india-news', authority: true },
  { name: 'news18-india', url: 'https://www.news18.com/commonfeeds/v1/eng/rss/india.xml', authority: true },
  { name: 'theprint', url: 'https://theprint.in/feed/', authority: true },
  { name: 'firstpost-india', url: 'https://www.firstpost.com/rss/india.xml', authority: true },
  { name: 'thewire', url: 'https://thewire.in/rss', authority: true },
  { name: 'scroll', url: 'https://scroll.in/feeds/all.rss', authority: true },
  { name: 'deccan-herald', url: 'https://www.deccanherald.com/rss-feed/52', authority: true },
  { name: 'tribune-hp', url: 'https://www.tribuneindia.com/rss/feed?catID=8', authority: true },
  { name: 'tribune-nation', url: 'https://www.tribuneindia.com/rss/feed?catID=10', authority: true },
  { name: 'india-today', url: 'https://www.indiatoday.in/rss/1206578', authority: true },
  { name: 'oneindia', url: 'https://www.oneindia.com/rss/news-india-fb.xml', authority: false },
  // --- Hindi outlets (authoritative regional reach)
  { name: 'bhaskar', url: 'https://www.bhaskar.com/rss-v1--category-1061.xml', authority: true },
  { name: 'amarujala-hp', url: 'https://www.amarujala.com/rss/himachal-pradesh.xml', authority: true },
  { name: 'jagran-national', url: 'https://www.jagran.com/rss/news/national.xml', authority: true },
  { name: 'ndtv-khabar', url: 'https://feeds.feedburner.com/ndtvkhabar-latest', authority: true }
];

function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#34;/g, '"')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function stripTags(s) { return decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

function parseRss(xml, max = 8) {
  const out = [];
  const blocks = xml.split(/<item>/i).slice(1);
  for (const block of blocks) {
    if (out.length >= max) break;
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

async function fetchWithTimeout(url, opts = {}, ms = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LocalPulse/1.0; +https://localpulse.dmj.one)', ...(opts.headers || {}) } });
  } finally { clearTimeout(timer); }
}

async function fetchFeed(src) {
  try {
    const r = await fetchWithTimeout(src.url);
    if (!r.ok) return [];
    const xml = await r.text();
    return parseRss(xml).map((it) => ({
      source: src.name,
      official: !!src.authority, // authoritative outlet corroboration counts toward "verified"
      title: it.title,
      text: it.description || it.title,
      url: it.link,
      publishedAt: it.pubDate ? Date.parse(it.pubDate) || Date.now() : Date.now()
    }));
  } catch { return []; }
}

// Reddit app-only OAuth (optional; only if creds provided).
let redditToken = { value: null, exp: 0 };
async function redditAuth() {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (redditToken.value && Date.now() < redditToken.exp) return redditToken.value;
  try {
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const r = await fetchWithTimeout('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!r.ok) return null;
    const j = await r.json();
    redditToken = { value: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
    return redditToken.value;
  } catch { return null; }
}
async function fetchReddit() {
  const token = await redditAuth();
  if (!token) return [];
  const subs = process.env.REDDIT_SUBS || 'himachal,india';
  try {
    const r = await fetchWithTimeout(`https://oauth.reddit.com/r/${subs}/new?limit=25`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.data?.children || []).map((c) => c.data).filter(Boolean).map((d) => ({
      source: 'reddit', official: false, title: d.title || '', text: (d.selftext || d.title || '').slice(0, 500),
      url: `https://www.reddit.com${d.permalink}`, publishedAt: (d.created_utc || 0) * 1000 || Date.now()
    })).filter((x) => x.title);
  } catch { return []; }
}

// Fetch every source in parallel; failures degrade to []. Returns a flat list.
async function fetchAll() {
  const tasks = SOURCES.map(fetchFeed).concat([fetchReddit()]);
  const results = await Promise.allSettled(tasks);
  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

function sourceCount() { return SOURCES.length + 1; }

module.exports = { fetchAll, fetchReddit, sourceCount, SOURCES };
