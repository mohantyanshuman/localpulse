const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../../services/secrets-bootstrap');

test('a *_FILE env var loads the file contents into the base env var', () => {
  const f = path.join(os.tmpdir(), `lp-secret-${Date.now()}.txt`);
  fs.writeFileSync(f, '  super-secret-value\n');
  delete process.env.LP_TEST_SECRET;
  process.env.LP_TEST_SECRET_FILE = f;
  load();
  assert.strictEqual(process.env.LP_TEST_SECRET, 'super-secret-value'); // trimmed
  delete process.env.LP_TEST_SECRET; delete process.env.LP_TEST_SECRET_FILE;
  fs.unlinkSync(f);
});

test('an explicit env var always wins over its *_FILE', () => {
  const f = path.join(os.tmpdir(), `lp-secret2-${Date.now()}.txt`);
  fs.writeFileSync(f, 'from-file');
  process.env.LP_TEST_SECRET2 = 'from-env';
  process.env.LP_TEST_SECRET2_FILE = f;
  load();
  assert.strictEqual(process.env.LP_TEST_SECRET2, 'from-env');
  delete process.env.LP_TEST_SECRET2; delete process.env.LP_TEST_SECRET2_FILE;
  fs.unlinkSync(f);
});

test('a missing secret file is ignored (graceful, no throw)', () => {
  delete process.env.LP_TEST_SECRET3;
  process.env.LP_TEST_SECRET3_FILE = '/no/such/secret/file';
  assert.doesNotThrow(() => load());
  assert.strictEqual(process.env.LP_TEST_SECRET3, undefined);
  delete process.env.LP_TEST_SECRET3_FILE;
});
