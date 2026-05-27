// LocalPulse — voice demo (Web Speech API). Browser-only; nothing leaves the device except intent text.
(function () {
  'use strict';

  const LANG_TAGS = { en: 'en-IN', hi: 'hi-IN', pa: 'pa-IN', ta: 'ta-IN', bn: 'bn-IN' };
  const STORAGE_LANG = 'lp.lang';
  const state = { lang: detectLang(), listening: false, rec: null, history: [], coords: null };

  // Acquire high-accuracy GPS once (on a user gesture) so the agent can act on
  // "send help to my location" without the caller reading out coordinates.
  function ensureLocation() {
    if (state.coords || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      function (pos) { state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      function () { /* denied: the agent still works, location tools just stay unavailable */ },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function detectLang() {
    try { const s = localStorage.getItem(STORAGE_LANG); if (s) return s; } catch (_) {}
    const n = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return ['en', 'hi', 'pa', 'ta', 'bn'].includes(n) ? n : 'en';
  }

  const $ = (s) => document.querySelector(s);
  const orb = $('#orb');
  const callBtn = $('#call-btn');
  const callState = $('#call-state');
  const capUser = $('#cap-user');
  const capBot = $('#cap-bot');
  const metaIntent = $('#meta-intent');
  const metaLang = $('#meta-lang');
  const transcriptEl = $('#transcript');

  function setOrb(mode) { orb.classList.remove('is-listening', 'is-speaking'); if (mode === 'listening') orb.classList.add('is-listening'); if (mode === 'speaking') orb.classList.add('is-speaking'); }
  function setCallState(s) { callState.textContent = s; }

  function ensureRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = LANG_TAGS[state.lang] || 'en-IN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    return r;
  }

  function startListening() {
    if (state.listening) return;
    ensureLocation();
    const r = ensureRecognition();
    if (!r) { capBot.textContent = 'Speech recognition not supported on this browser. Try the suggested phrases instead.'; return; }
    state.rec = r;
    state.listening = true;
    callBtn.classList.add('is-active');
    callBtn.lastChild.textContent = ' Listening… tap to stop';
    setCallState('listening');
    setOrb('listening');
    capUser.textContent = '…';
    r.onresult = (ev) => { const text = ev.results[0][0].transcript; handleUtterance(text); };
    r.onerror = (ev) => { stopListening(); capBot.textContent = 'Speech error: ' + ev.error; };
    r.onend = () => stopListening();
    try { r.start(); } catch (_) { stopListening(); }
  }
  function stopListening() {
    state.listening = false;
    callBtn.classList.remove('is-active');
    callBtn.lastChild.textContent = ' Tap to talk';
    setCallState('idle');
    setOrb('idle');
    if (state.rec) try { state.rec.stop(); } catch (_) {}
    state.rec = null;
  }

  async function handleUtterance(text) {
    capUser.textContent = text;
    setCallState('thinking');
    appendTranscript('user', text);
    const body = { q: text, history: state.history.slice(-8), lang: state.lang };
    if (state.coords) { body.lat = state.coords.lat; body.lng = state.coords.lng; }
    try {
      const r = await fetch('/api/voice/converse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const j = await r.json();
      const answer = j.answer || 'Sorry, I could not work that out. For an emergency, call 112.';
      capBot.textContent = answer;
      if (Array.isArray(j.history)) state.history = j.history;
      // Surface the heavy lifting: which live sources the agent consulted this turn.
      metaIntent.textContent = (j.used && j.used.length) ? j.used.join(' · ') : (j.intent || j.mode || 'reasoning');
      metaLang.textContent = j.lang || state.lang;
      appendTranscript('bot', answer);
      speak(answer);
    } catch (e) {
      // Network fallback to the simple intent endpoint so the line never goes dead.
      try {
        const r2 = await fetch('/api/voice/intent?lang=' + state.lang, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        const j2 = await r2.json();
        capBot.textContent = j2.response; metaIntent.textContent = j2.intent; metaLang.textContent = j2.lang;
        appendTranscript('bot', j2.response); speak(j2.response);
      } catch (_) { capBot.textContent = 'Could not reach the helpline. For an emergency, call 112.'; setCallState('idle'); }
    }
  }

  function appendTranscript(who, text) {
    const li = document.createElement('li');
    const w = document.createElement('span');
    w.className = 'who ' + who;
    w.textContent = (who === 'user' ? 'You' : 'LocalPulse');
    li.appendChild(w);
    const sp = document.createElement('span');
    sp.textContent = text;
    li.appendChild(sp);
    transcriptEl.prepend(li);
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    setCallState('speaking');
    setOrb('speaking');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG_TAGS[state.lang] || 'en-IN';
    u.rate = 0.95;
    u.pitch = 1.0;
    u.onend = () => { setOrb('idle'); setCallState('idle'); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  callBtn.addEventListener('click', () => { if (state.listening) stopListening(); else startListening(); });
  document.querySelectorAll('.suggest').forEach(btn => { btn.addEventListener('click', () => { ensureLocation(); handleUtterance(btn.dataset.text); }); });
  $('#clear-transcript').addEventListener('click', () => { while (transcriptEl.firstChild) transcriptEl.removeChild(transcriptEl.firstChild); });

  const sel = $('#lang-select');
  if (sel) {
    sel.value = state.lang;
    metaLang.textContent = state.lang;
    sel.addEventListener('change', () => {
      state.lang = sel.value;
      try { localStorage.setItem(STORAGE_LANG, state.lang); } catch (_) {}
      metaLang.textContent = state.lang;
    });
  }

  capUser.textContent = 'Press the orange button below and speak. Or tap a suggestion on the right.';

  if ('serviceWorker' in navigator) {
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloaded) return; reloaded = true; location.reload(); });
    navigator.serviceWorker.register('/sw.js').then(function (reg) { try { reg.update(); } catch (e) {} }).catch(function () {});
  }
})();
