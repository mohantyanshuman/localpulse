// LocalPulse — voice helpline as a natural, hands-free CALL.
// Tap once to start: it listens, answers with the agentic backend, then listens again
// automatically (echo-safe: it never listens while speaking), like a real phone call,
// until you hang up. Speech (STT + TTS) stays on-device via the Web Speech API; only the
// recognized text goes to the server. Resilient to the browser speech service's flaky
// "network" errors: inside a call it retries with backoff instead of dropping the call.
(function () {
  'use strict';

  const LANG_TAGS = { en: 'en-IN', hi: 'hi-IN', pa: 'pa-IN', ta: 'ta-IN', bn: 'bn-IN' };
  const STORAGE_LANG = 'lp.lang';
  // phase: 'idle' | 'listening' | 'thinking' | 'speaking'
  const state = { lang: detectLang(), inCall: false, phase: 'idle', rec: null, coords: null, history: [], errStreak: 0 };

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
  function setPhase(p) {
    state.phase = p;
    callState.textContent = state.inCall ? ({ idle: 'connecting…', listening: 'listening…', thinking: 'thinking…', speaking: 'speaking…' }[p] || 'on call') : 'idle';
    setOrb(p === 'listening' ? 'listening' : p === 'speaking' ? 'speaking' : 'idle');
  }
  function setButton() {
    callBtn.classList.toggle('is-active', state.inCall);
    if (callBtn.lastChild) callBtn.lastChild.textContent = state.inCall ? ' End call' : ' Tap to start call';
  }

  // High-accuracy GPS once (user gesture) so "send help to my location" just works.
  function ensureLocation() {
    if (state.coords || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      function (pos) { state.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      function () { /* denied: agent still works, location tools stay unavailable */ },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function newRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = LANG_TAGS[state.lang] || 'en-IN';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    return r;
  }

  function stopRec() {
    if (state.rec) { try { state.rec.onresult = state.rec.onerror = state.rec.onend = null; state.rec.stop(); } catch (_) {} state.rec = null; }
  }

  // --- Call control ---
  function startCall() {
    if (state.inCall) return;
    ensureLocation();
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      capBot.textContent = 'Voice is not supported on this browser. Try Chrome, or tap a suggestion on the right.';
      return;
    }
    state.inCall = true; state.errStreak = 0;
    setButton();
    capBot.textContent = 'Connected. Go ahead, I am listening.';
    speak('Hello, this is LocalPulse. I am here with you. How can I help?', listenTurn);
  }
  function endCall() {
    state.inCall = false;
    stopRec();
    try { window.speechSynthesis.cancel(); } catch (_) {}
    setPhase('idle'); setButton();
    capUser.textContent = 'Call ended. Tap to start again.';
  }

  function listenTurn() {
    if (!state.inCall || state.phase === 'listening') return;
    const r = newRecognition();
    if (!r) { endCall(); return; }
    state.rec = r;
    setPhase('listening');
    capUser.textContent = '…';
    r.onresult = function (ev) {
      state.errStreak = 0;
      const text = ev.results[0][0].transcript;
      stopRec();
      processUtterance(text);
    };
    r.onerror = function (ev) { handleSpeechError(ev.error); };
    r.onend = function () { if (state.inCall && state.phase === 'listening') retryListen(600); };
    try { r.start(); } catch (_) { retryListen(800); }
  }

  function handleSpeechError(err) {
    stopRec();
    if (!state.inCall) return;
    if (err === 'not-allowed' || err === 'service-not-allowed') { capBot.textContent = 'I need microphone permission to talk. Please allow it, then tap to start the call.'; endCall(); return; }
    if (err === 'audio-capture') { capBot.textContent = 'No microphone was found. Please check your device.'; endCall(); return; }
    if (err === 'no-speech' || err === 'aborted') { retryListen(400); return; }
    // 'network' or other: the browser speech service is flaky — back off and keep the call alive.
    state.errStreak += 1;
    const wait = Math.min(8000, 800 * Math.pow(2, state.errStreak - 1));
    if (state.errStreak <= 6) { callState.textContent = 'reconnecting…'; retryListen(wait); }
    else { capBot.textContent = 'The speech service keeps dropping. I am still on the line — tap a suggestion, or end and retry the call.'; setPhase('idle'); }
  }

  function retryListen(ms) { if (!state.inCall) return; setTimeout(function () { if (state.inCall && state.phase !== 'thinking' && state.phase !== 'speaking') listenTurn(); }, ms || 500); }

  async function processUtterance(text) {
    capUser.textContent = text;
    setPhase('thinking');
    appendTranscript('user', text);
    const body = { q: text, history: state.history.slice(-8), lang: state.lang };
    if (state.coords) { body.lat = state.coords.lat; body.lng = state.coords.lng; }
    let answer = null; let meta = '';
    try {
      const r = await fetch('/api/voice/converse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 429) { answer = 'We are getting a lot of calls right now. Please hold on a moment and try again.'; }
      else {
        const j = await r.json();
        answer = j.answer || null;
        if (Array.isArray(j.history)) state.history = j.history;
        meta = (j.used && j.used.length) ? j.used.join(' · ') : (j.intent || j.mode || 'reasoning');
        metaLang.textContent = j.lang || state.lang;
      }
    } catch (e) { answer = null; }
    if (!answer) {
      // Network fallback to the simple intent endpoint so the line never goes dead.
      try {
        const r2 = await fetch('/api/voice/intent?lang=' + state.lang, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        const j2 = await r2.json(); answer = j2.response; meta = j2.intent;
      } catch (_) { answer = 'I could not reach the line just now. For an emergency, please call one one two.'; }
    }
    capBot.textContent = answer;
    if (meta) metaIntent.textContent = meta;
    appendTranscript('bot', answer);
    // Speak the reply, then (if still on the call) listen again — a natural to-and-fro.
    speak(answer, function () { if (state.inCall) listenTurn(); });
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

  // Warm-sounding TTS; picks a voice matching the language when one is available.
  function pickVoice() {
    try {
      const want = (LANG_TAGS[state.lang] || 'en-IN').toLowerCase();
      const voices = window.speechSynthesis.getVoices() || [];
      return voices.find((v) => v.lang && v.lang.toLowerCase() === want)
        || voices.find((v) => v.lang && v.lang.toLowerCase().slice(0, 2) === state.lang)
        || null;
    } catch (_) { return null; }
  }
  function speak(text, done) {
    if (!('speechSynthesis' in window)) { if (done) done(); return; }
    setPhase('speaking');
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG_TAGS[state.lang] || 'en-IN';
    const v = pickVoice(); if (v) u.voice = v;
    u.rate = 0.98; u.pitch = 1.05; // gentle, warm cadence
    let finished = false;
    const finish = function () { if (finished) return; finished = true; if (done) done(); };
    u.onend = finish;
    u.onerror = finish;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (_) { finish(); }
    // Safety net: if onend never fires (some browsers), continue after a bounded wait.
    setTimeout(finish, Math.min(15000, 2500 + text.length * 70));
  }

  callBtn.addEventListener('click', function () { if (state.inCall) endCall(); else startCall(); });
  document.querySelectorAll('.suggest').forEach(function (btn) {
    btn.addEventListener('click', function () { ensureLocation(); if (state.phase === 'thinking' || state.phase === 'speaking') return; processUtterance(btn.dataset.text); });
  });
  $('#clear-transcript').addEventListener('click', function () { while (transcriptEl.firstChild) transcriptEl.removeChild(transcriptEl.firstChild); });

  const sel = $('#lang-select');
  if (sel) {
    sel.value = state.lang;
    metaLang.textContent = state.lang;
    sel.addEventListener('change', function () {
      state.lang = sel.value;
      try { localStorage.setItem(STORAGE_LANG, state.lang); } catch (_) {}
      metaLang.textContent = state.lang;
    });
  }

  // Preload voices (Chrome populates asynchronously).
  if ('speechSynthesis' in window) { try { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); }; } catch (_) {} }

  setButton();
  capUser.textContent = 'Tap the green button to start a call, or tap a suggestion on the right.';

  if ('serviceWorker' in navigator) {
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloaded) return; reloaded = true; location.reload(); });
    navigator.serviceWorker.register('/sw.js').then(function (reg) { try { reg.update(); } catch (e) {} }).catch(function () {});
  }
})();
