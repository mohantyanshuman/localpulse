const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// Start the server on an ephemeral port in-process.
process.env.PORT = '0';
const app = require('../../server'); // server.js must export the http.Server

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = app.address();
    const req = http.request({ host: '127.0.0.1', port: addr.port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/eo returns an assessment shape', async () => {
  const r = await get('/api/eo?lat=48.85&lng=2.35');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok(['ok', 'elevated', 'high', 'severe'].includes(j.level));
  assert.ok(Array.isArray(j.perHazard));
  assert.ok(Array.isArray(j.sensorsUsed));
  assert.ok(j.location && typeof j.location.lat === 'number');
});

test('GET /api/eo uses Cloudflare headers when lat/lng absent', async () => {
  const r = await get('/api/eo', { 'cf-iplatitude': '35.68', 'cf-iplongitude': '139.69', 'cf-ipcountry': 'JP' });
  const j = JSON.parse(r.body);
  assert.ok(Math.abs(j.location.lat - 35.68) < 1e-6);
  assert.strictEqual(j.location.source, 'edge');
});

test.after(() => app.close());
