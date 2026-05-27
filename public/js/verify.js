// Standalone offline verifier for LocalPulse Warning Certificates. Pure client-side
// (WebCrypto via eo-offline.js). No server call needed to verify; the "fetch live"
// button is only a convenience to obtain a fresh certificate to inspect.
(function () {
  const $ = (id) => document.getElementById(id);
  const ta = $('cert');
  const result = $('result');

  function show(ok, lines) {
    result.style.display = 'block';
    result.className = ok ? 'ok' : 'bad';
    result.innerHTML = '';
    const v = document.createElement('div');
    v.className = 'verdict';
    v.textContent = ok ? '✓ Authentic and untampered' : '✗ Verification failed';
    result.appendChild(v);
    for (const ln of lines) {
      const d = document.createElement('div');
      d.className = 'kv';
      d.textContent = ln;
      result.appendChild(d);
    }
  }

  async function verify() {
    let cert;
    try { cert = JSON.parse(ta.value.trim()); } catch { show(false, ['Could not parse JSON.']); return; }
    if (!window.EOOffline || !EOOffline.verifyCertificate) { show(false, ['Verifier unavailable.']); return; }
    const r = await EOOffline.verifyCertificate(cert);
    const ageMin = cert.issuedAt ? Math.round((Date.now() - cert.issuedAt) / 60000) : null;
    const lines = [
      `Headline: ${cert.headline || '(none)'}`,
      `Signature valid: ${r.signatureValid === undefined ? r.valid : r.signatureValid}`,
      `Chain self-consistent: ${r.chainOk}`,
      `Chain position (seq): ${r.seq}`,
      `Public-key fingerprint: ${r.fingerprint || '(none)'}`,
      `Issued: ${cert.issuedAt ? new Date(cert.issuedAt).toISOString() : '(unknown)'}${ageMin != null ? ` (${ageMin} min ago)` : ''}`,
    ];
    if (!r.valid && r.reason) lines.push(`Reason: ${r.reason}`);
    show(!!r.valid, lines);
  }

  $('verify').addEventListener('click', verify);
  $('sample').addEventListener('click', async () => {
    try { ta.value = await navigator.clipboard.readText(); } catch { ta.placeholder = 'Clipboard blocked. Paste manually.'; }
  });
  $('load').addEventListener('click', () => {
    if (!navigator.geolocation) { fetchCert(); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => fetchCert(p.coords.latitude, p.coords.longitude),
      () => fetchCert()
    );
  });
  async function fetchCert(lat, lng) {
    const qs = (lat != null && lng != null) ? `?lat=${lat}&lng=${lng}` : '';
    try {
      const r = await fetch(`/api/eo/certificate${qs}`);
      ta.value = JSON.stringify(await r.json(), null, 2);
    } catch { ta.placeholder = 'Could not fetch (offline?). Paste a certificate manually.'; }
  }
})();
