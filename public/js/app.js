// LocalPulse — shared client logic for /, /responder
(function () {
  'use strict';

  const LANGS = ['en', 'hi', 'pa', 'ta', 'bn'];
  const STORAGE = { LANG: 'lp.lang', THEME: 'lp.theme' };
  const SOLAN = [30.9087, 77.0959];

  const state = {
    lang: detectLang(),
    dict: null,
    incidents: [],
    shelters: [],
    summary: null,
    filter: 'all',
    map: null,
    markers: [],
    lastFetchOk: 0
  };

  function detectLang() {
    try { const s = localStorage.getItem(STORAGE.LANG); if (s && LANGS.includes(s)) return s; } catch (_) {}
    const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return LANGS.includes(n) ? n : 'en';
  }
  function saveLang(l) { try { localStorage.setItem(STORAGE.LANG, l); } catch (_) {} }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE.THEME, theme); } catch (_) {}
  }
  function loadTheme() {
    try { const s = localStorage.getItem(STORAGE.THEME); if (s) return s; } catch (_) {}
    return document.documentElement.getAttribute('data-theme') || 'light';
  }

  function applyI18n() {
    if (!state.dict) return;
    const get = (path) => path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), state.dict);
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = get(el.getAttribute('data-i18n'));
      if (v != null) el.textContent = v;
    });
    document.documentElement.setAttribute('lang', state.lang);
  }

  async function fetchJson(url, opts) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctrl.signal, credentials: 'same-origin' }, opts || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      state.lastFetchOk = Date.now();
      cacheStash(url, j);
      return j;
    } catch (e) {
      const cached = cacheLoad(url);
      if (cached) return cached;
      throw e;
    } finally { clearTimeout(t); }
  }
  function cacheStash(url, data) { try { localStorage.setItem('lp.cache:' + url, JSON.stringify({ ts: Date.now(), data })); } catch (_) {} }
  function cacheLoad(url) { try { const r = localStorage.getItem('lp.cache:' + url); if (!r) return null; return JSON.parse(r).data; } catch (_) { return null; } }

  function formatAgo(ts) { return Math.max(1, Math.round((Date.now() - ts) / 60000)) + 'm'; }

  function setStatus(s) {
    const pill = document.getElementById('status-pill');
    if (!pill) return;
    pill.setAttribute('data-state', s);
    const span = pill.querySelector('span:last-child');
    if (span) {
      const map = {
        online: { en: 'Live', hi: 'लाइव', pa: 'ਲਾਈਵ', ta: 'நேரலை', bn: 'লাইভ' },
        stale:  { en: 'Cached', hi: 'कैश्ड', pa: 'ਕੈਸ਼', ta: 'கேஷ்', bn: 'ক্যাশ' },
        offline:{ en: 'Offline', hi: 'ऑफ़लाइन', pa: 'ਆਫ਼ਲਾਈਨ', ta: 'ஆஃப்லைன்', bn: 'অফলাইন' }
      };
      span.textContent = (map[s] && map[s][state.lang]) || s;
    }
  }

  function initMap() {
    const el = document.getElementById('map');
    if (!el || !window.L) return;
    state.map = L.map(el, { zoomControl: true }).setView(SOLAN, 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(state.map);
  }
  function clearMarkers() { state.markers.forEach(m => state.map.removeLayer(m)); state.markers = []; }
  function renderMarkers() {
    if (!state.map) return;
    clearMarkers();
    const items = state.filter === 'all' ? state.incidents : state.incidents.filter(i => i.category === state.filter);
    items.forEach(i => {
      const color = sevColor(i);
      const marker = L.circleMarker([i.lat, i.lng], { radius: 10, color, fillColor: color, fillOpacity: 0.65, weight: 2 }).addTo(state.map);
      const div = document.createElement('div');
      const t = document.createElement('strong'); t.textContent = i.title; div.appendChild(t);
      div.appendChild(document.createElement('br'));
      div.appendChild(document.createTextNode(i.summary));
      div.appendChild(document.createElement('br'));
      const sm = document.createElement('small');
      sm.textContent = i.verified + '/' + i.sources + ' verified · trust ' + Math.round(i.trust * 100) + '%';
      div.appendChild(sm);
      marker.bindPopup(div);
      state.markers.push(marker);
    });
    state.shelters.forEach(s => {
      const m = L.marker([s.lat, s.lng], { title: s.name });
      const d = document.createElement('div');
      const t = document.createElement('strong'); t.textContent = s.name; d.appendChild(t);
      d.appendChild(document.createElement('br'));
      d.appendChild(document.createTextNode(kindLabel(s.kind) + (s.phone ? ' · ' + s.phone : '')));
      m.bindPopup(d).addTo(state.map);
      state.markers.push(m);
    });
  }
  function sevColor(i) {
    if (i.category === 'rumor') return '#6B21A8';
    if (i.severity === 'high') return '#B42318';
    if (i.severity === 'medium') return '#B25E09';
    return '#1E66F5';
  }

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('data-')) e.setAttribute(k, attrs[k]);
      else if (k === 'title' || k === 'role' || k === 'aria-label') e.setAttribute(k, attrs[k]);
      else if (k === 'style') e.style.cssText = attrs[k];
      else e[k] = attrs[k];
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(c => {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function catLabel(c) { const d = state.dict && state.dict.cat; return (d && d[c]) || c; }

  function renderIncidents() {
    const list = document.getElementById('incident-list');
    const count = document.getElementById('incident-count');
    if (!list) return;
    const items = state.filter === 'all' ? state.incidents : state.incidents.filter(i => i.category === state.filter);
    if (count) count.textContent = items.length + ' active';
    clear(list);
    items.forEach(i => {
      const li = el('li', { class: 'incident', 'data-sev': i.severity, 'data-cat': i.category });
      li.appendChild(el('span', { class: 'incident-bar', 'aria-hidden': 'true' }));
      const main = el('div');
      main.appendChild(el('h3', { class: 'incident-title' }, i.title));
      main.appendChild(el('p', { class: 'incident-summary' }, i.summary));
      const meta = el('div', { class: 'incident-meta' });
      meta.appendChild(el('span', { class: 'cat-tag', 'data-cat': i.category }, catLabel(i.category)));
      if (i.src === 'community') {
        const st = i.status === 'corroborated' ? { t: '✓ verified', c: 'shelter' } : i.status === 'contradicted' ? { t: '✗ disputed', c: 'rumor' } : { t: 'community', c: 'water' };
        meta.appendChild(el('span', { class: 'cat-tag', 'data-cat': st.c, title: i.note || 'Resident report' }, st.t));
      }
      meta.appendChild(el('span', null, i.verified + '/' + i.sources + ' verified'));
      const tb = el('span', { class: 'trust-bar', title: 'trust ' + Math.round(i.trust * 100) + '%' });
      tb.appendChild(el('span', { style: 'width:' + Math.round(i.trust * 100) + '%' }));
      meta.appendChild(tb);
      const dk = distKm(i);
      if (dk != null) meta.appendChild(el('span', { title: 'Distance from you' }, '~' + (dk < 1 ? '<1' : Math.round(dk)) + ' km'));
      meta.appendChild(el('span', null, formatAgo(i.updatedAt) + ' ago'));
      main.appendChild(meta);
      li.appendChild(main);
      li.appendChild(el('div'));
      list.appendChild(li);
    });
  }

  function renderSummary() {
    const ul = document.getElementById('summary-list');
    if (!ul || !state.summary) return;
    clear(ul);
    state.summary.bullets.forEach(b => ul.appendChild(el('li', null, b)));
  }

  const KINDS = {
    hospital: { en: 'Hospital', hi: 'अस्पताल', pa: 'ਹਸਪਤਾਲ', ta: 'மருத்துவமனை', bn: 'হাসপাতাল' },
    clinic: { en: 'Clinic', hi: 'क्लिनिक', pa: 'ਕਲੀਨਿਕ', ta: 'மருத்துவ மையம்', bn: 'ক্লিনিক' },
    police: { en: 'Police', hi: 'पुलिस', pa: 'ਪੁਲਿਸ', ta: 'காவல்', bn: 'পুলিশ' },
    community_centre: { en: 'Community centre', hi: 'सामुदायिक केंद्र', pa: 'ਕਮਿਊਨਿਟੀ ਸੈਂਟਰ', ta: 'சமூக மையம்', bn: 'কমিউনিটি কেন্দ্র' },
    school: { en: 'School', hi: 'विद्यालय', pa: 'ਸਕੂਲ', ta: 'பள்ளி', bn: 'বিদ্যালয়' },
    shelter: { en: 'Shelter', hi: 'आश्रय', pa: 'ਆਸ਼ਰਯ', ta: 'தங்குமிடம்', bn: 'আশ্রয়' }
  };
  function kindLabel(k) { return (KINDS[k] && KINDS[k][state.lang]) || (KINDS[k] && KINDS[k].en) || k; }

  function renderShelters() {
    const grid = document.getElementById('shelter-grid');
    if (!grid) return;
    clear(grid);
    state.shelters.forEach(s => {
      const card = el('article', { class: 'shelter', 'data-kind': s.kind });
      card.appendChild(el('h3', null, s.name));
      const am = el('div', { class: 'amen' });
      am.appendChild(el('span', { 'data-cat': s.kind }, kindLabel(s.kind)));
      card.appendChild(am);
      if (s.phone) {
        const tel = el('a', { class: 'muted small', href: 'tel:' + s.phone }, '☎ ' + s.phone);
        card.appendChild(tel);
      }
      const dir = el('a', { class: 'muted small', href: 'https://www.openstreetmap.org/?mlat=' + s.lat + '&mlon=' + s.lng + '#map=17/' + s.lat + '/' + s.lng, target: '_blank', rel: 'noopener' }, 'Directions');
      card.appendChild(dir);
      grid.appendChild(card);
    });
  }

  const DSS_LABEL = {
    ok: { en: 'All clear', hi: 'सामान्य', pa: 'ਸਭ ਠੀਕ', ta: 'பாதுகாப்பு', bn: 'সব ঠিক' },
    elevated: { en: 'Elevated', hi: 'सतर्क', pa: 'ਸਾਵਧਾਨ', ta: 'எச்சரிக்கை', bn: 'সতর্ক' },
    high: { en: 'High risk', hi: 'उच्च जोखिम', pa: 'ਉੱਚ ਜੋਖਮ', ta: 'அதிக ஆபத்து', bn: 'উচ্চ ঝুঁকি' },
    severe: { en: 'Severe', hi: 'गंभीर', pa: 'ਗੰਭੀਰ', ta: 'கடுமை', bn: 'গুরুতর' }
  };
  const DSS_HEADLINE = {
    ok: { en: 'No major hazards right now. Stay aware and keep your phone charged.', hi: 'अभी कोई बड़ा खतरा नहीं। सतर्क रहें और फोन चार्ज रखें।', pa: 'ਹੁਣੇ ਕੋਈ ਵੱਡਾ ਖ਼ਤਰਾ ਨਹੀਂ। ਸਾਵਧਾਨ ਰਹੋ ਤੇ ਫ਼ੋਨ ਚਾਰਜ ਰੱਖੋ।', ta: 'இப்போது பெரிய ஆபத்து இல்லை. விழிப்புடன் இருங்கள், போனை சார்ஜ் செய்யுங்கள்.', bn: 'এখন বড় কোনো বিপদ নেই। সতর্ক থাকুন, ফোন চার্জ রাখুন।' },
    elevated: { en: 'Elevated risk. Monitor updates and avoid affected areas.', hi: 'जोखिम बढ़ा है। अपडेट देखें और प्रभावित क्षेत्रों से बचें।', pa: 'ਜੋਖਮ ਵਧਿਆ ਹੈ। ਅਪਡੇਟ ਵੇਖੋ ਤੇ ਪ੍ਰਭਾਵਿਤ ਖੇਤਰਾਂ ਤੋਂ ਬਚੋ।', ta: 'ஆபத்து அதிகரித்துள்ளது. புதுப்பிப்புகளைப் பாருங்கள், பாதிக்கப்பட்ட பகுதிகளைத் தவிர்க்கவும்.', bn: 'ঝুঁকি বেড়েছে। আপডেট দেখুন, ক্ষতিগ্রস্ত এলাকা এড়িয়ে চলুন।' },
    high: { en: 'High risk. Follow advisories and avoid non-essential travel.', hi: 'उच्च जोखिम। सलाह मानें और गैर-जरूरी यात्रा से बचें।', pa: 'ਉੱਚ ਜੋਖਮ। ਸਲਾਹ ਮੰਨੋ ਤੇ ਗੈਰ-ਜ਼ਰੂਰੀ ਸਫ਼ਰ ਤੋਂ ਬਚੋ।', ta: 'அதிக ஆபத்து. அறிவுறுத்தல்களைப் பின்பற்றுங்கள், தேவையற்ற பயணத்தைத் தவிர்க்கவும்.', bn: 'উচ্চ ঝুঁকি। নির্দেশিকা মানুন, অপ্রয়োজনীয় ভ্রমণ এড়িয়ে চলুন।' },
    severe: { en: 'Severe. Act on official instructions immediately; move to safety.', hi: 'गंभीर। आधिकारिक निर्देशों का तुरंत पालन करें; सुरक्षित स्थान पर जाएँ।', pa: 'ਗੰਭੀਰ। ਅਧਿਕਾਰਤ ਹਦਾਇਤਾਂ ਤੁਰੰਤ ਮੰਨੋ; ਸੁਰੱਖਿਅਤ ਥਾਂ ਜਾਓ।', ta: 'கடுமை. அதிகாரப்பூர்வ அறிவுறுத்தல்களை உடனே பின்பற்றுங்கள்; பாதுகாப்பான இடத்துக்கு செல்லுங்கள்.', bn: 'গুরুতর। সরকারি নির্দেশ এখনই মানুন; নিরাপদ স্থানে যান।' }
  };
  function renderDss(d) {
    const panel = document.getElementById('dss-panel');
    if (!panel || !d || !d.level) return;
    const L = (m) => (m[d.level] && (m[d.level][state.lang] || m[d.level].en)) || '';
    panel.setAttribute('data-level', d.level);
    panel.hidden = false;
    const lvl = document.getElementById('dss-level');
    if (lvl) { lvl.setAttribute('data-level', d.level); lvl.textContent = L(DSS_LABEL); }
    const hl = document.getElementById('dss-headline');
    if (hl) hl.textContent = d.headline || L(DSS_HEADLINE) || ''; // server's dynamic, location-honest headline
    const wx = document.getElementById('dss-weather');
    if (wx) wx.textContent = d.weather ? `${d.weather.condition}, ${Math.round(d.weather.tempC)}°C` + (d.weather.precipTomorrowMm ? ` · rain ${d.weather.precipTomorrowMm}mm` : '') + (d.weather.aqi != null ? ` · AQI ${d.weather.aqi}` : '') : '';
    const ul = document.getElementById('dss-recs');
    if (ul) {
      clear(ul);
      (d.recommendations || []).forEach(r => {
        const li = el('li', { 'data-level': r.level || 'low' });
        if (r.link) { li.appendChild(document.createTextNode(r.text + ' ')); li.appendChild(el('a', { href: r.link, target: '_blank', rel: 'noopener' }, 'details')); }
        else li.appendChild(document.createTextNode(r.text));
        ul.appendChild(li);
      });
    }
  }

  function setKpi(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }

  // --- Web push: subscribe to risk + verified-emergency alerts
  function urlB64ToUint8(b) {
    const pad = '='.repeat((4 - b.length % 4) % 4);
    const raw = atob((b + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }
  async function enableAlerts(btn) {
    const label = btn.querySelector('span') || btn;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { label.textContent = 'Alerts unsupported'; return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      if ((await Notification.requestPermission()) !== 'granted') { label.textContent = 'Alerts blocked'; return; }
      const meta = await (await fetch('/api/push/key')).json();
      if (!meta.enabled || !meta.key) { label.textContent = 'Alerts unavailable'; return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(meta.key) });
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
      const j = await r.json();
      try { localStorage.setItem('lp.pushid', j.id || '1'); } catch (_) {}
      label.textContent = '✓ Alerts on'; btn.disabled = true;
    } catch (_) { label.textContent = 'Alerts failed'; }
  }
  function bindAlerts() {
    const btn = document.getElementById('enable-alerts');
    if (!btn) return;
    let on = false; try { on = !!localStorage.getItem('lp.pushid'); } catch (_) {}
    if (on) { const l = btn.querySelector('span') || btn; l.textContent = '✓ Alerts on'; btn.disabled = true; }
    btn.addEventListener('click', () => enableAlerts(btn));
  }

  // Personalize the risk panel to the user's location (incidents scoped to a radius).
  function bindNearMe() {
    const btn = document.getElementById('dss-nearme');
    if (!btn || !navigator.geolocation) { if (btn) btn.style.display = 'none'; return; }
    btn.addEventListener('click', () => {
      btn.textContent = '📍 Locating…';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          state.userLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const d = await fetchJson('/api/dss?lat=' + state.userLoc.lat + '&lng=' + state.userLoc.lng);
          renderDss(d);
          renderIncidents();
          btn.textContent = '📍 Your area';
        } catch (_) { btn.textContent = '📍 Near me'; }
      }, () => { btn.textContent = '📍 Near me'; }, { timeout: 6000, maximumAge: 60000 });
    });
  }
  // Distance from the user to an incident, if location is known.
  function distKm(i) {
    if (!state.userLoc || typeof i.lat !== 'number') return null;
    const R = 6371, tr = (x) => x * Math.PI / 180;
    const dLat = tr(i.lat - state.userLoc.lat), dLng = tr(i.lng - state.userLoc.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(tr(state.userLoc.lat)) * Math.cos(tr(i.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function bindFilters() {
    document.querySelectorAll('.chip[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chip[data-filter]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        state.filter = btn.dataset.filter;
        renderIncidents();
        renderMarkers();
      });
    });
  }

  function bindForm() {
    const form = document.getElementById('user-report-form');
    if (!form) return;
    const status = document.getElementById('form-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { category: fd.get('category'), message: String(fd.get('message') || '').trim(), lang: state.lang };
      if (!body.message) { status.dataset.state = 'err'; status.textContent = 'Please describe what is happening.'; return; }
      status.dataset.state = ''; status.textContent = 'Sending…';
      // Best-effort: pin the report at the resident's real location (4s budget).
      if (navigator.geolocation) {
        try {
          const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000, maximumAge: 60000 }));
          body.lat = pos.coords.latitude; body.lng = pos.coords.longitude;
        } catch (_) { /* no location — server defaults to town centre */ }
      }
      try {
        const r = await fetchJson('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        status.textContent = 'Thanks. Reference: ' + r.id + '. Responders see verified reports within 60s.';
        form.reset();
      } catch (e) {
        status.dataset.state = 'err';
        status.textContent = 'Could not send. Saved locally; we will retry when online.';
        try { localStorage.setItem('lp.queued', JSON.stringify({ ts: Date.now(), body })); } catch (_) {}
      }
    });
  }

  function bindPulse() {
    if (!('EventSource' in window)) return;
    const es = new EventSource('/api/pulse');
    const stream = document.getElementById('pulse-stream');
    es.addEventListener('pulse', (e) => {
      try {
        const d = JSON.parse(e.data);
        setKpi('kpi-incidents', d.activeIncidents);
        setKpi('kpi-shelters', d.sheltersOpen);
        if (typeof d.sourcesIngested === 'number') setKpi('kpi-sources', d.sourcesIngested.toLocaleString());
        setStatus('online');
        if (stream) {
          const line = '[' + new Date(d.ts).toLocaleTimeString() + '] inc=' + d.activeIncidents + ' facilities=' + d.sheltersOpen + ' sources=' + d.sourcesIngested + ' mode=' + (d.mode || '') + '\n';
          stream.textContent = (line + stream.textContent).slice(0, 4000);
        }
      } catch (_) {}
    });
    es.addEventListener('error', () => setStatus('stale'));
  }

  async function reload() {
    try {
      const [d, s, i, sh, dss] = await Promise.all([
        fetchJson('/api/i18n'),
        fetchJson('/api/summary?lang=' + state.lang),
        fetchJson('/api/incidents?lang=' + state.lang),
        fetchJson('/api/shelters'),
        fetchJson('/api/dss').catch(() => null)
      ]);
      state.dict = d.dict[state.lang] || d.dict.en;
      state.summary = s;
      state.incidents = i.items;
      state.shelters = sh.items;
      window.LP_state = state;
      applyI18n();
      if (dss) renderDss(dss);
      renderSummary();
      renderIncidents();
      renderShelters();
      renderMarkers();
      setStatus('online');
      setKpi('kpi-incidents', state.incidents.length);
      setKpi('kpi-shelters', state.shelters.length);
      setKpi('kpi-langs', String(LANGS.length));
      // kpi-sources is filled by the live pulse stream with the real count.
    } catch (e) { setStatus('offline'); }
  }

  function boot() {
    applyTheme(loadTheme());
    const tb = document.getElementById('theme-toggle');
    if (tb) tb.addEventListener('click', () => {
      const next = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      applyTheme(next);
    });
    const sel = document.getElementById('lang-select');
    if (sel) {
      sel.value = state.lang;
      sel.addEventListener('change', () => { state.lang = sel.value; saveLang(state.lang); reload(); });
    }
    initMap();
    bindFilters();
    bindForm();
    bindPulse();
    bindAlerts();
    bindNearMe();
    reload();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
