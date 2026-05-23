// LocalPulse — Web Push notifications (VAPID). Free, standards-based.
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

// Fan out a notification to every subscriber. payload: {title, body, url, tag}.
async function sendToAll(payload) {
  if (!ensure()) return { sent: 0, skipped: 'no-vapid' };
  const subs = await persist.listPushSubs();
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent += 1;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await persist.deletePushSub(s.id); } catch { /* ignore */ } }
    }
  }));
  return { sent, total: subs.length };
}

module.exports = { sendToAll, hasVapid, publicKey };
