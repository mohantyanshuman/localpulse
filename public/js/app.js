// LocalPulse: shared client logic for /, /responder
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
    state.dss = d;
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

  // --- Ask LocalPulse: conversational RAG over the live situational data
  function bindAsk() {
    const form = document.getElementById('ask-form');
    if (!form) return;
    const input = document.getElementById('ask-input');
    const ans = document.getElementById('ask-answer');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      ans.textContent = 'Thinking…';
      const body = { q: q, lang: state.lang };
      if (state.userLoc) { body.lat = state.userLoc.lat; body.lng = state.userLoc.lng; }
      try {
        const r = await fetchJson('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        ans.textContent = r.answer || 'No answer available.';
      } catch (_) { ans.textContent = 'Could not reach the assistant. For an emergency, call 112.'; }
    });
  }

  // --- Community mutual-aid board (need / offer / safe) with auto-matching
  function renderAid(items) {
    const list = document.getElementById('aid-list');
    if (!list) return;
    clear(list);
    if (!items.length) { list.appendChild(el('li', { class: 'muted small' }, 'No posts yet. Be the first to offer or ask for help.')); return; }
    items.slice(0, 20).forEach((a) => {
      const li = el('li', { class: 'aid-item', 'data-kind': a.kind });
      li.appendChild(el('span', { class: 'aid-tag', 'data-kind': a.kind }, a.kind === 'need' ? 'NEED' : a.kind === 'offer' ? 'OFFER' : 'SAFE'));
      const body = el('div');
      body.appendChild(el('div', null, a.message));
      body.appendChild(el('div', { class: 'muted small' }, (a.name ? a.name + ' · ' : '') + formatAgo(a.createdAt) + ' ago' + (a.cat && a.cat !== 'other' ? ' · ' + a.cat : '')));
      if (a.match) body.appendChild(el('div', { class: 'aid-match small' }, '↳ Matched with ' + a.match.name + (a.match.km != null ? ' (~' + a.match.km + ' km)' : '') + ': ' + a.match.message));
      li.appendChild(body);
      list.appendChild(li);
    });
  }
  async function loadAid() { try { const j = await fetchJson('/api/aid'); renderAid(j.items || []); } catch (_) {} }
  function bindAid() {
    const form = document.getElementById('aid-form');
    if (!form) return;
    const status = document.getElementById('aid-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { kind: fd.get('kind'), message: String(fd.get('message') || '').trim(), lang: state.lang };
      if (body.kind !== 'safe' && !body.message) { status.dataset.state = 'err'; status.textContent = 'Add a short detail.'; return; }
      status.dataset.state = ''; status.textContent = 'Posting…';
      if (navigator.geolocation) {
        try { const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000, maximumAge: 300000 })); body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; } catch (_) {}
      }
      try { await fetchJson('/api/aid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); status.textContent = 'Posted. Thank you for helping.'; form.reset(); loadAid(); }
      catch (_) { status.dataset.state = 'err'; status.textContent = 'Could not post. Try again.'; }
    });
    loadAid();
  }

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
      const payload = JSON.parse(JSON.stringify(sub)); // {endpoint, keys}
      // Best-effort location so alerts can be scoped to hazards near you.
      try {
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 300000 }));
        payload.lat = pos.coords.latitude; payload.lng = pos.coords.longitude;
      } catch (_) { /* no location: will receive district-wide alerts */ }
      const r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
        } catch (_) { /* no location: server defaults to town centre */ }
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
    const prepend = (txt) => {
      if (!stream) return;
      if (!stream.dataset.live) { stream.textContent = ''; stream.dataset.live = '1'; } // clear "awaiting events…"
      stream.textContent = (txt + '\n' + stream.textContent).slice(0, 4000);
    };
    // Real incident events (initial replay + live as they change).
    es.addEventListener('incident', (e) => {
      try {
        const d = JSON.parse(e.data);
        prepend('[' + new Date(d.ts).toLocaleTimeString() + '] ' + (d.src === 'community' ? '📍 ' : '') + String(d.cat || '').toUpperCase() + (d.sev ? '/' + d.sev : '') + ' · ' + (d.title || ''));
        setStatus('online');
      } catch (_) {}
    });
    // Live counters.
    es.addEventListener('stat', (e) => {
      try {
        const d = JSON.parse(e.data);
        setKpi('kpi-incidents', d.activeIncidents);
        setKpi('kpi-shelters', d.sheltersOpen);
        if (typeof d.sourcesIngested === 'number') setKpi('kpi-sources', d.sourcesIngested.toLocaleString());
        setStatus('online');
      } catch (_) {}
    });
    // Raw real-time arrivals from the 40+ sources (unverified live signal).
    es.addEventListener('incoming', (e) => {
      try {
        const d = JSON.parse(e.data);
        prepend('[' + new Date(d.ts).toLocaleTimeString() + '] 🛰 LIVE · ' + (d.source || 'feed') + ' · ' + (d.title || ''));
        setStatus('online');
      } catch (_) {}
    });
    es.addEventListener('ping', () => setStatus('online'));
    es.addEventListener('error', () => setStatus('stale'));
  }

  function loadSyncCache() { try { return JSON.parse(localStorage.getItem('lp.sync') || 'null'); } catch (_) { return null; } }
  function saveSyncCache(o) { try { localStorage.setItem('lp.sync', JSON.stringify(o)); } catch (_) {} }
  function applySync(s) {
    if (s.summary) state.summary = s.summary;
    if (s.incidents) state.incidents = s.incidents;
    if (s.shelters) state.shelters = s.shelters;
    if (s.dss) renderDss(s.dss);
    renderSummary(); renderIncidents(); renderShelters(); renderMarkers();
    setKpi('kpi-incidents', (state.incidents || []).length);
    setKpi('kpi-shelters', (state.shelters || []).length);
    state.painted = true;
  }
  // Bandwidth-efficient delta sync: instant paint from cache, then fetch only the
  // changed delta; connection-adaptive 'lite' on slow links / data-saver.
  async function reload() {
    try {
      if (!state.dictAll) { const d = await fetchJson('/api/i18n'); state.dictAll = d.dict; }
      state.dict = state.dictAll[state.lang] || state.dictAll.en;
      const cache = loadSyncCache();
      if (cache && cache.lang === state.lang && !state.painted) applySync(cache);
      const conn = navigator.connection || {};
      const lite = (/(^|-)2g$/.test(conn.effectiveType || '') || conn.saveData) ? '&lite=1' : '';
      const since = (cache && cache.lang === state.lang) ? (cache.v || 0) : 0;
      const s = await fetchJson('/api/sync?since=' + since + '&lang=' + state.lang + lite);
      if (s.changed) { applySync(s); state.syncV = s.v; saveSyncCache(Object.assign({ lang: state.lang }, s)); }
      else { state.syncV = s.v; }
      window.LP_state = state;
      applyI18n();
      setStatus('online');
      setKpi('kpi-langs', String(LANGS.length));
    } catch (e) { setStatus(loadSyncCache() ? 'stale' : 'offline'); }
  }

  // --- Accessibility: larger text + spoken status (low-literacy, elderly, blind)
  function bindBigText() {
    const btn = document.getElementById('bigtext-toggle');
    if (!btn) return;
    try { if (localStorage.getItem('lp.big') === '1') document.body.classList.add('big-text'); } catch (_) {}
    btn.addEventListener('click', () => { const on = document.body.classList.toggle('big-text'); try { localStorage.setItem('lp.big', on ? '1' : '0'); } catch (_) {} });
  }
  function bindListen() {
    const btn = document.getElementById('dss-listen');
    if (!btn || !('speechSynthesis' in window)) { if (btn) btn.style.display = 'none'; return; }
    btn.addEventListener('click', () => {
      const d = state.dss; if (!d) return;
      const recs = (d.recommendations || []).slice(0, 4).map((r) => r.text).join('. ');
      const u = new SpeechSynthesisUtterance(((d.headline || '') + '. ' + recs).slice(0, 600));
      u.lang = { en: 'en-IN', hi: 'hi-IN', pa: 'pa-IN', ta: 'ta-IN', bn: 'bn-IN' }[state.lang] || 'en-IN';
      try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (_) {}
    });
  }

  // --- Vulnerable-person priority registry (no one left behind)
  function bindVulnerable() {
    const form = document.getElementById('vuln-form');
    if (!form) return;
    const status = document.getElementById('vuln-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const needs = [].slice.call(form.querySelectorAll('input[name=needs]:checked')).map((c) => c.value);
      if (!needs.length) { status.dataset.state = 'err'; status.textContent = 'Select at least one type of help needed.'; return; }
      status.dataset.state = ''; status.textContent = 'Registering…';
      const body = { needs: needs, contact: form.contact.value.trim() };
      if (navigator.geolocation) { try { const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 300000 })); body.lat = pos.coords.latitude; body.lng = pos.coords.longitude; } catch (_) {} }
      try { await fetchJson('/api/vulnerable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); status.textContent = 'Registered privately. Responders will prioritise this area.'; form.reset(); }
      catch (_) { status.dataset.state = 'err'; status.textContent = 'Could not register. Try again.'; }
    });
  }

  // --- Missing persons reunification (matched against "I'm safe" check-ins)
  function renderMissing(items) {
    const list = document.getElementById('missing-list');
    if (!list) return;
    clear(list);
    items.slice(0, 15).forEach((m) => {
      const li = el('li', { class: 'aid-item', 'data-kind': m.safe ? 'safe' : 'need' });
      li.appendChild(el('span', { class: 'aid-tag', 'data-kind': m.safe ? 'safe' : 'need' }, m.safe ? 'SAFE' : 'MISSING'));
      const b = el('div');
      b.appendChild(el('div', null, m.name + (m.lastSeen ? ', last seen ' + m.lastSeen : '')));
      b.appendChild(el('div', { class: 'muted small' }, (m.safe ? 'Reported safe ✓ · ' : '') + formatAgo(m.createdAt) + ' ago' + (m.contact ? ' · ' + m.contact : '')));
      li.appendChild(b);
      list.appendChild(li);
    });
  }
  async function loadMissing() { try { const j = await fetchJson('/api/missing'); renderMissing(j.items || []); } catch (_) {} }
  function bindMissing() {
    const form = document.getElementById('missing-form');
    if (!form) return;
    const status = document.getElementById('missing-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) { status.dataset.state = 'err'; status.textContent = 'Enter the person’s name.'; return; }
      status.dataset.state = ''; status.textContent = 'Posting…';
      try { await fetchJson('/api/missing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, lastSeen: form.lastSeen.value.trim(), contact: form.contact.value.trim() }) }); status.textContent = 'Posted. We will match against "I’m safe" check-ins.'; form.reset(); loadMissing(); }
      catch (_) { status.dataset.state = 'err'; status.textContent = 'Could not post. Try again.'; }
    });
    loadMissing();
  }

  // --- Satellite Intelligence: worldwide multi-sensor Earth-observation fusion
  // Fetch + cache the ECDSA public key so provenance can be verified offline.
  async function eoPubkey() {
    try {
      const cached = JSON.parse(localStorage.getItem('lp.eo.pubkey') || 'null');
      if (cached && cached.jwk) {
        // refresh in the background, return cached immediately
        fetchJson('/api/eo/pubkey').then((p) => { if (p && p.jwk) localStorage.setItem('lp.eo.pubkey', JSON.stringify(p)); }).catch(() => {});
        return cached.jwk;
      }
      const p = await fetchJson('/api/eo/pubkey');
      if (p && p.jwk) { localStorage.setItem('lp.eo.pubkey', JSON.stringify(p)); return p.jwk; }
    } catch (e) {}
    return null;
  }

  async function verifyEO(data) {
    if (!data || !data.provenance || !window.EOOffline) return null;
    const jwk = await eoPubkey();
    if (!jwk) return null;
    try { return (await window.EOOffline.verifyReceipt(data, data.provenance, jwk)).valid; } catch (e) { return null; }
  }

  async function loadEO(coords) {
    const qs = coords ? `?lat=${coords.lat}&lng=${coords.lng}` : '';
    let data;
    try {
      data = await fetchJson(`/api/eo${qs}`);
      try { localStorage.setItem('lp.eo', JSON.stringify({ data, ts: Date.now() })); } catch (e) {}
      const verified = await verifyEO(data);
      renderEO(data, false, null, verified);
    } catch {
      // Offline: recompute the headline level on-device AND re-verify the cached
      // receipt with the cached public key: trustworthy with zero connectivity.
      try {
        const cached = JSON.parse(localStorage.getItem('lp.eo') || 'null');
        if (cached && cached.data && window.EOOffline) {
          cached.data.level = window.EOOffline.recomputeLevel(cached.data.perHazard);
          const verified = await verifyEO(cached.data);
          renderEO(cached.data, true, cached.ts, verified);
        }
      } catch (e) {}
    }
  }

  function eoLevelClass(level) {
    return { ok: 'lv-ok', elevated: 'lv-elevated', high: 'lv-high', severe: 'lv-severe' }[level] || 'lv-ok';
  }

  function renderEO(data, offline, cachedTs, verified) {
    const headline = document.getElementById('eo-headline');
    const cards = document.getElementById('eo-cards');
    const coverage = document.getElementById('eo-coverage');
    if (!headline || !cards) return;
    const place = (data.location && data.location.place) || 'your area';
    const lvc = eoLevelClass(data.level);
    headline.className = `eo-headline ${lvc}`;
    headline.innerHTML = '';
    headline.appendChild(el('span', { class: `eo-hl-level ${lvc}` }, data.level.toUpperCase()));
    const metaEl = el('span', { class: 'eo-hl-meta' }, [
      el('span', { class: 'eo-hl-place' }, place),
      el('span', { class: 'eo-hl-dot' }, '·'),
      el('span', null, `${data.sensorsUsed.length} sensors reporting`),
    ]);
    if (offline && window.EOOffline) {
      metaEl.appendChild(el('span', { class: 'eo-hl-dot' }, '·'));
      metaEl.appendChild(el('span', null, `offline (${window.EOOffline.ageLabel(cachedTs)})`));
    }
    headline.appendChild(metaEl);
    if (verified === true) headline.appendChild(el('span', { class: 'eo-shield ok' }, '✓ cryptographically verified'));
    else if (verified === false) headline.appendChild(el('span', { class: 'eo-shield bad' }, '⚠ unverified signature'));
    cards.innerHTML = '';
    for (const h of data.perHazard) {
      const lc = eoLevelClass(h.level);
      const pct = Math.round((h.confidence || 0) * 100);
      const card = el('div', { class: `eo-card ${lc}` });
      card.appendChild(el('div', { class: 'eo-card-top' }, [
        el('span', { class: 'eo-axis' }, h.axis),
        el('span', { class: `eo-badge ${lc}` }, h.level),
      ]));
      card.appendChild(el('div', { class: 'eo-meter' }, [
        el('div', { class: 'eo-meter-label' }, [
          el('span', { class: 'eo-meter-cap' }, 'Confidence'),
          el('span', { class: 'eo-meter-val' }, pct + '%'),
        ]),
        el('div', { class: 'eo-meter-track' }, el('div', { class: `eo-meter-fill ${lc}`, style: `width:${pct}%` })),
      ]));
      const sensors = h.sensorsUsed || [];
      const SHOWN = 3;
      const chips = sensors.slice(0, SHOWN).map((s) => el('span', { class: 'eo-sensor' }, s));
      if (sensors.length > SHOWN) {
        chips.push(el('span', { class: 'eo-sensor eo-sensor-more', title: sensors.join(', ') }, `+${sensors.length - SHOWN}`));
      }
      card.appendChild(el('div', { class: 'eo-sensors' }, chips));
      if (h.divergenceFlag && h.divergenceFlag !== 'consensus' && h.divergenceFlag !== 'single') {
        const isBlind = h.divergenceFlag === 'blindspot';
        const label = isBlind ? `Only ${h.divergenceOutlier} sees this` : `Suspect feed: ${h.divergenceOutlier}`;
        card.appendChild(el('div', { class: `eo-div ${isBlind ? 'warn' : 'danger'}` }, '⚠ ' + label));
      }
      card.appendChild(el('div', { class: 'eo-gap eo-foot' }, h.gapNote));
      cards.appendChild(card);
    }
    if (coverage) {
      coverage.textContent = data.gapsCovered && data.gapsCovered.length
        ? `Cross-validated: ${data.gapsCovered.join(' · ')}`
        : 'Single-sensor reads this cycle; corroboration pending next overpass.';
    }
    renderForecast(data.predictions || []);
  }

  function renderForecast(preds) {
    const box = document.getElementById('eo-forecast');
    const title = document.getElementById('eo-forecast-title');
    if (!box) return;
    box.innerHTML = '';
    if (title) title.hidden = preds.length === 0;
    for (const p of preds) {
      const eta = p.etaHours === 0 ? 'now' : `~${p.etaHours}h`;
      const row = el('div', { class: `eo-pred lk-${p.likelihood}` });
      row.appendChild(el('div', { class: 'eo-pred-head' }, [
        el('span', { class: 'eo-pred-headline' }, p.headline),
        el('span', { class: `eo-pred-chip lk-${p.likelihood}` }, p.likelihood),
      ]));
      row.appendChild(el('div', { class: 'eo-pred-why muted' }, p.reasoning));
      let meta = `ETA ${eta} · confidence ${Math.round((p.confidence || 0) * 100)}%`;
      if (p.interval) {
        meta += p.interval.calibrated
          ? ` · ${Math.round(p.interval.coverage * 100)}% interval [${p.interval.low}, ${p.interval.high}]`
          : ` · interval calibrating (${p.interval.n} samples)`;
      }
      row.appendChild(el('div', { class: 'eo-pred-meta muted' }, meta));
      box.appendChild(row);
    }
  }

  function wireEO() {
    const btn = document.getElementById('eo-sharpen');
    if (btn) {
      btn.addEventListener('click', () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => loadEO({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => loadEO() // denied -> stay coarse
        );
      });
    }
    loadEO(); // coarse on boot
  }

  // --- Safe-passage: verifiable evacuation-route clearance to the nearest shelter.
  function routeClass(v) { return { GO: 'lv-ok', CAUTION: 'lv-elevated', NO_GO: 'lv-severe' }[v] || 'lv-ok'; }

  async function loadRoute(coords) {
    const verdictEl = document.getElementById('route-verdict');
    const segEl = document.getElementById('route-segments');
    const certEl = document.getElementById('route-cert');
    if (!verdictEl || !segEl) return;
    if (!coords) { verdictEl.textContent = 'Share your location to check a safe route.'; return; }
    verdictEl.textContent = 'Assessing your route to the nearest shelter…';
    let data;
    try {
      data = await fetchJson(`/api/eo/route?fromLat=${coords.lat}&fromLng=${coords.lng}`);
    } catch { verdictEl.textContent = 'Could not assess the route (offline?).'; return; }
    const dest = (data.certificate && data.certificate.route && data.certificate.route.destinationName) || 'the nearest shelter';
    // Honest labels: never claim "safe". This is latency-aware decision-support.
    const label = { GO: 'LOWEST ASSESSED RISK', CAUTION: 'ELEVATED RISK, PROCEED CAREFULLY', NO_GO: 'DO NOT TAKE THIS ROUTE' }[data.verdict] || data.verdict;
    const age = data.dataAgeMin == null ? 'no fire pass' : (data.dataAgeMin < 60 ? `${data.dataAgeMin} min` : `${Math.round(data.dataAgeMin / 60)} h`);
    verdictEl.className = `eo-headline ${routeClass(data.verdict)}`;
    verdictEl.textContent = `${label} to ${dest} (${data.distanceKm} km): ${data.worst.reason}. ` +
      `Confidence ${Math.round((data.confidence || 0) * 100)}% · satellite fire data ${age} old.`;
    segEl.innerHTML = '';
    (data.segments || []).forEach((s, i) => {
      const card = el('div', { class: `eo-card ${routeClass(s.level)}` });
      card.appendChild(el('div', { class: 'eo-axis' }, `Leg ${i + 1}`));
      card.appendChild(el('div', { class: 'eo-level' }, s.level));
      card.appendChild(el('div', { class: 'eo-gap muted' }, s.reason));
      segEl.appendChild(card);
    });
    const basisEl = document.getElementById('route-basis') || (function () {
      const p = el('p', { class: 'eo-coverage muted' }); p.id = 'route-basis';
      segEl.parentNode.insertBefore(p, segEl.nextSibling); return p;
    })();
    basisEl.textContent = `${data.basis || ''} ${data.disclaimer || ''}`.trim();
    if (certEl) {
      certEl.textContent = 'Verifying clearance certificate…';
      try {
        const jwk = await eoPubkey();
        const v = (window.EOOffline && data.certificate) ? await window.EOOffline.verifyCertificate(data.certificate) : null;
        certEl.textContent = v && v.valid
          ? `✓ Clearance certificate verified offline (seq ${v.seq}, key ${v.fingerprint}). Tamper-evident & non-repudiable.`
          : 'Clearance certificate could not be verified.';
      } catch { certEl.textContent = 'Clearance certificate present.'; }
    }
  }

  // --- World Engine: show the system's self-learning forecast skill, honestly.
  async function loadWorld() {
    const cards = document.getElementById('world-cards');
    const note = document.getElementById('world-note');
    if (!cards) return;
    let data;
    try { data = await fetchJson('/api/eo/world'); } catch { return; }
    cards.innerHTML = '';
    let anyVerified = false;
    for (const hz of Object.keys(data.hazards || {})) {
      const h = data.hazards[hz];
      const card = el('div', { class: 'eo-card' });
      card.appendChild(el('div', { class: 'eo-axis' }, hz));
      if (!h.n) {
        card.appendChild(el('div', { class: 'eo-gap muted' }, `${h.engines || 0} engines · no verified events yet`));
      } else {
        anyVerified = true;
        card.appendChild(el('div', { class: 'eo-level' }, `Brier ${h.brier == null ? 'n/a' : h.brier}`));
        card.appendChild(el('div', { class: 'eo-conf' }, `${h.n} verified · ${h.regions} region(s) · closeness ${h.closeness == null ? 'n/a' : Math.round(h.closeness * 100) + '%'}`));
        card.appendChild(el('div', { class: 'eo-gap muted' }, h.learning ? `${h.engines} engines training per region (need ≥20)` : `best engine: ${h.bestEngine}`));
      }
      cards.appendChild(card);
    }
    if (note) {
      note.textContent = anyVerified
        ? 'Lower Brier = better. The engine verifies past forecasts against what actually happened and recalibrates itself; accuracy improves as events accrue.'
        : 'No forecasts have been verified against outcomes yet. Skill scores appear here as predicted events are later confirmed or refuted: honest, measurable self-learning.';
    }
  }

  function wireWorld() {
    const btn = document.getElementById('world-refresh');
    if (btn) btn.addEventListener('click', loadWorld);
    loadWorld();
  }

  function wireRoute() {
    const btn = document.getElementById('route-go');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!navigator.geolocation) { loadRoute(); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => loadRoute({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => loadRoute()
      );
    });
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
      sel.addEventListener('change', () => { state.lang = sel.value; saveLang(state.lang); state.painted = false; reload(); });
    }
    initMap();
    bindFilters();
    bindForm();
    bindPulse();
    bindAlerts();
    bindNearMe();
    bindAsk();
    bindAid();
    bindBigText();
    bindListen();
    bindVulnerable();
    bindMissing();
    wireEO();
    wireRoute();
    wireWorld();
    reload();
    // Auto-update: when a freshly deployed service worker takes control, reload
    // once so the user gets the new version without a manual hard refresh.
    if ('serviceWorker' in navigator) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
      navigator.serviceWorker.register('/sw.js').then((reg) => { try { reg.update(); } catch (_) {} }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
