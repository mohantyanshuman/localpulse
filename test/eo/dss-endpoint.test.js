const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
process.env.PORT = '0';
const app = require('../../server');

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = app.address();
    const req = http.request({ host: '127.0.0.1', port: addr.port, path, method: 'GET', headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end();
  });
}

test('GET /api/dss?lat&lng includes a satellite summary', async () => {
  const r = await get('/api/dss?lat=34.05&lng=-118.24');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.ok('satellite' in j, 'dss response carries satellite summary');
});

test.after(() => app.close());
