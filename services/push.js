// LocalPulse: Web Push notifications (VAPID). Free, standards-based.
// Lets residents subscribe and get alerted when the town risk escalates or a
// citizen report is corroborated. Subscriptions live in Firestore; dead ones
// (404/410) are pruned automatically.
const webpush = require('web-push');
const persist = require('./persist');

let configured = null;
function ensure() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { configured = false; return false; }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@dmj.one', pub, priv);
    configured = true;
  } catch { configured = false; }
  return configured;
}

function publicKey() { return process.env.VAPID_PUBLIC_KEY || null; }
function hasVapid() { return ensure(); }

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function deliver(subs, payload) {
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent += 1;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await persist.deletePushSub(s.id); } catch { /* ignore */ } }
    }
  }));
  return sent;
}

// Fan out to every subscriber (use for genuine district-wide hazards).
async function sendToAll(payload) {
  if (!ensure()) return { sent: 0, skipped: 'no-vapid' };
  const subs = await persist.listPushSubs();
  return { sent: await deliver(subs, payload), total: subs.length };
}

// Locality-scoped: only notify subscribers within radiusKm of a localized event.
// Subscribers who never shared a location still get it (can't scope them out).
async function sendNear(payload, center, radiusKm = 12) {
  if (!ensure()) return { sent: 0, skipped: 'no-vapid' };
  if (!center || typeof center.lat !== 'number') return sendToAll(payload);
  const subs = await persist.listPushSubs();
  const targeted = subs.filter((s) => (typeof s.lat !== 'number') || haversineKm(center.lat, center.lng, s.lat, s.lng) <= radiusKm);
  return { sent: await deliver(targeted, payload), targeted: targeted.length, total: subs.length };
}

module.exports = { sendToAll, sendNear, hasVapid, publicKey };
