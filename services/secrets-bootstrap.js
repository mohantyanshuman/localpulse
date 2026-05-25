// Secret bootstrap — load secrets provided as MOUNTED FILES, the leak-resistant way.
//
// Convention (Docker/Kubernetes/Cloud-Run + Secret Manager): for any environment
// variable `FOO_FILE` whose value is a readable path, set `FOO` to the file's trimmed
// contents (unless `FOO` is already set explicitly). On Cloud Run, mounting a Secret
// Manager secret as a FILE (a volume) instead of injecting it as a plaintext env var
// means the secret value:
//   - never appears in the service / revision configuration (so it cannot be read back
//     via `gcloud run services describe` or the console),
//   - is not present in the process environment block (so it will not leak via an env
//     dump, a child process inheriting env, a crash report, or an accidental log),
//   - is delivered encrypted, read only by the service account granted secretAccessor.
// The application keeps reading `process.env.FOO`; only the delivery is hardened.
//
// Local dev still works: set the plain env var (or use a .env) and this is a no-op.
const fs = require('fs');

function load() {
  for (const key of Object.keys(process.env)) {
    if (!key.endsWith('_FILE')) continue;
    const base = key.slice(0, -5);
    if (!base || process.env[base]) continue; // an explicit env var always wins
    const path = process.env[key];
    if (!path) continue;
    try {
      const v = fs.readFileSync(path, 'utf8').trim();
      if (v) process.env[base] = v;
    } catch (e) {
      // Missing/unreadable secret file: leave unset so the feature degrades gracefully
      // rather than crashing. Do NOT log the path or any value.
    }
  }
}

load();

module.exports = { load };
