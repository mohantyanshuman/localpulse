// Worldwide location resolution. Coarse: Cloudflare edge headers (no prompt).
// Precise: client-supplied lat/lng. Reverse geocode for a human place name.
const { getJson } = require('./eo/http');

const DEFAULT_LOC = {
  lat: Number(process.env.DEFAULT_LAT) || 20,
  lng: Number(process.env.DEFAULT_LNG) || 0,
};

function coarseFromHeaders(headers = {}, fallback = DEFAULT_LOC) {
  const lat = parseFloat(headers['cf-iplatitude']);
  const lng = parseFloat(headers['cf-iplongitude']);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, country: headers['cf-ipcountry'] || null, source: 'edge' };
  }
  return { lat: fallback.lat, lng: fallback.lng, country: null, source: 'default' };
}

// Free reverse geocode (BigDataCloud client-free endpoint). Degrades to null.
async function reverseGeocode(lat, lng) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
  const j = await getJson(url, 6000);
  if (!j) return null;
  return {
    place: j.city || j.locality || j.principalSubdivision || j.countryName || null,
    region: j.principalSubdivision || null,
    country: j.countryName || null,
    countryCode: j.countryCode || null,
  };
}

module.exports = { coarseFromHeaders, reverseGeocode, DEFAULT_LOC };
