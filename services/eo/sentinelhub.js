// Copernicus Data Space (CDSE) Sentinel Hub client: OAuth client-credentials
// token (cached) + Statistical API helper. Free tier. Degrades to null on any
// failure so a Sentinel outage never breaks fusion.
const { getText } = require('./http');

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';

let cached = { token: null, exp: 0 };

function hasCreds() {
  return !!(process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET);
}

function bboxAround(lat, lng, d = 0.05) {
  return [
    +(lng - d).toFixed(6), +(lat - d).toFixed(6),
    +(lng + d).toFixed(6), +(lat + d).toFixed(6),
  ];
}

async function token() {
  if (!hasCreds()) return null;
  const now = Date.now();
  if (cached.token && now < cached.exp) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.COPERNICUS_CLIENT_ID,
    client_secret: process.env.COPERNICUS_CLIENT_SECRET,
  }).toString();
  const txt = await getText(TOKEN_URL, 9000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!txt) return null;
  let j; try { j = JSON.parse(txt); } catch { return null; }
  if (!j.access_token) return null;
  cached = { token: j.access_token, exp: now + Math.max(0, (j.expires_in || 600) - 60) * 1000 };
  return cached.token;
}

// Run a Statistical API request for one collection over the last `days`.
async function statistics({ collection, evalscript, lat, lng, days = 7, resm = 50 }) {
  const tok = await token();
  if (!tok) return null;
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  const bbox = bboxAround(lat, lng);
  const payload = {
    input: {
      bounds: { bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
      data: [{ type: collection }],
    },
    aggregation: {
      timeRange: { from: from.toISOString(), to: to.toISOString() },
      aggregationInterval: { of: 'P1D' },
      evalscript,
      resx: 0.0005, resy: 0.0005,
    },
    calculations: { default: {} },
  };
  const txt = await getText(STATS_URL, 12000, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

// Most recent interval's mean for output id "data", band "B0".
function latestMean(resp) {
  const data = resp && Array.isArray(resp.data) ? resp.data : null;
  if (!data || !data.length) return null;
  const withMean = data
    .map((d) => ({
      from: d.interval && d.interval.from,
      mean: d.outputs && d.outputs.data && d.outputs.data.bands && d.outputs.data.bands.B0
        && d.outputs.data.bands.B0.stats && d.outputs.data.bands.B0.stats.mean,
    }))
    .filter((x) => Number.isFinite(x.mean));
  if (!withMean.length) return null;
  withMean.sort((a, b) => String(b.from).localeCompare(String(a.from)));
  return withMean[0].mean;
}

module.exports = { hasCreds, bboxAround, token, statistics, latestMean };
