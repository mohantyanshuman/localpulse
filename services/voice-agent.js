// LocalPulse — agentic voice helpline.
// A caller speaks naturally; this runs a Gemini (flash-lite) function-calling loop
// that decides which live LocalPulse data to look up, reasons across satellite +
// ground + official sources, uses the caller's GPS automatically, and can take real
// actions (file a report, mark "I'm safe", register a missing person) with spoken
// confirmation. Stateless: the client holds the conversation and resends it each turn,
// so this stays Cloud-Run scale-to-zero friendly. STT/TTS live in the browser.
//
// Budget-guarded (daily cap + per-turn step cap + timeouts) and degrades to null so the
// caller can fall back to the free keyword bot when Gemini is unavailable.

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const DAILY_CAP = Number(process.env.VOICE_DAILY_CAP || 400);
const MAX_STEPS = Number(process.env.VOICE_MAX_STEPS || 4);
const MAX_HISTORY = 8;

const LANG_NAME = { en: 'English', hi: 'Hindi', pa: 'Punjabi', ta: 'Tamil', bn: 'Bengali' };

let day = '';
let count = 0;
function budgetOk() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; count = 0; }
  return count < DAILY_CAP;
}

// Lazily require the real services so the module loads cheaply and tests can inject.
function realServices() {
  return {
    store: require('../data/store'),
    dss: require('./dss'),
    eoFusion: require('./eo/fusion'),
    eoRoute: require('./eo/route'),
    geolocate: require('./geolocate'),
    persist: require('./persist'),
    ingest: require('./ingest'),
  };
}

// Resolve a usable coordinate: explicit tool arg wins, else the caller's GPS.
function coord(args, ctx, latKey = 'lat', lngKey = 'lng') {
  const lat = Number.isFinite(args[latKey]) ? args[latKey] : ctx.lat;
  const lng = Number.isFinite(args[lngKey]) ? args[lngKey] : ctx.lng;
  return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
}

function nearest(facilities, lat, lng, kinds) {
  let pick = facilities || [];
  if (kinds && kinds.length) {
    const f = pick.filter((x) => kinds.includes(x.kind));
    if (f.length) pick = f;
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    pick = [...pick].sort((a, b) =>
      ((a.lat - lat) ** 2 + (a.lng - lng) ** 2) - ((b.lat - lat) ** 2 + (b.lng - lng) ** 2));
  }
  return pick.slice(0, 3).map((f) => ({ name: f.name, kind: f.kind, phone: f.phone || null, lat: f.lat, lng: f.lng }));
}

// --- Tool registry. Each tool: { decl (Gemini functionDeclaration), write?, run(args, ctx) }.
// ctx = { lat, lng, place, lang, svc }.
const TOOLS = {
  get_local_risk: {
    decl: {
      name: 'get_local_risk',
      description: "The caller's personalized current risk level and recommendations at their location (ground incidents fused with the live satellite assessment). Use for 'am I safe', 'what's happening near me'.",
      parameters: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
    },
    async run(args, ctx) {
      const c = coord(args, ctx);
      let assessment = ctx.svc.dss.assess(ctx.svc.store.getIncidents(), ctx.svc.store.getHazards() || {}, ctx.svc.store.getFacilities(), c ? { userLoc: c } : {});
      if (c) { try { assessment = ctx.svc.dss.mergeEo(assessment, await ctx.svc.eoFusion.fuse(c.lat, c.lng)); } catch { /* EO optional */ } }
      return { level: assessment.level, headline: assessment.headline, recommendations: (assessment.recommendations || []).slice(0, 4) };
    },
  },
  get_satellite_assessment: {
    decl: {
      name: 'get_satellite_assessment',
      description: "Worldwide multi-sensor satellite hazard assessment at a point (flood, fire, air, heat, storm, seismic, vegetation) with confidence. Use for environmental hazards from space.",
      parameters: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
    },
    async run(args, ctx) {
      const c = coord(args, ctx);
      if (!c) return { error: 'no_location' };
      const eo = await ctx.svc.eoFusion.fuse(c.lat, c.lng);
      return { level: eo.level, hazards: (eo.perHazard || []).map((h) => ({ axis: h.axis, level: h.level, confidence: Math.round((h.confidence || 0) * 100) })) };
    },
  },
  get_incidents: {
    decl: {
      name: 'get_incidents',
      description: 'Current verified local incidents, optionally filtered by category (road, power, water, medical, shelter, weather). Nearest first when location is known.',
      parameters: { type: 'object', properties: { category: { type: 'string' } } },
    },
    async run(args, ctx) {
      let items = ctx.svc.store.getIncidents();
      if (args.category) items = items.filter((i) => i.category === args.category);
      if (Number.isFinite(ctx.lat) && Number.isFinite(ctx.lng)) {
        items = [...items].sort((a, b) => ((a.lat - ctx.lat) ** 2 + (a.lng - ctx.lng) ** 2) - ((b.lat - ctx.lat) ** 2 + (b.lng - ctx.lng) ** 2));
      }
      return { count: items.length, items: items.slice(0, 6).map((i) => ({ category: i.category, severity: i.severity, title: (i.title && (i.title.en || i.title)) || '', status: i.status || null })) };
    },
  },
  get_hazards: {
    decl: { name: 'get_hazards', description: 'Live weather, recent earthquakes, official NDMA/IMD alerts and air quality for the area.', parameters: { type: 'object', properties: {} } },
    async run(_args, ctx) {
      const h = ctx.svc.store.getHazards() || {};
      return {
        weather: h.weather || null,
        airQuality: h.airQuality ? { aqi: h.airQuality.aqi } : null,
        quakes: (h.quakes || []).slice(0, 3),
        officialAlerts: (h.alerts || []).slice(0, 4).map((a) => a.title),
      };
    },
  },
  find_facilities: {
    decl: {
      name: 'find_facilities',
      description: 'Nearest relief facilities to the caller: hospital, clinic, police, shelter, school, community_centre. Returns names, phone numbers and distance order.',
      parameters: { type: 'object', properties: { kind: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } } },
    },
    async run(args, ctx) {
      const c = coord(args, ctx) || {};
      const kinds = args.kind ? [args.kind] : null;
      return { facilities: nearest(ctx.svc.store.getFacilities(), c.lat, c.lng, kinds) };
    },
  },
  check_safe_route: {
    decl: {
      name: 'check_safe_route',
      description: "Assess whether the route from the caller's location to a destination (or the nearest shelter if none given) is safe right now. Returns a GO / CAUTION / NO_GO verdict.",
      parameters: { type: 'object', properties: { fromLat: { type: 'number' }, fromLng: { type: 'number' }, toLat: { type: 'number' }, toLng: { type: 'number' } } },
    },
    async run(args, ctx) {
      const from = coord(args, ctx, 'fromLat', 'fromLng');
      if (!from) return { error: 'no_location' };
      let to = (Number.isFinite(args.toLat) && Number.isFinite(args.toLng)) ? { lat: args.toLat, lng: args.toLng } : null;
      if (!to) {
        const fac = ctx.svc.store.getFacilities() || [];
        let best = null; let bd = Infinity;
        for (const f of fac) { if (!Number.isFinite(f.lat)) continue; const d = (f.lat - from.lat) ** 2 + (f.lng - from.lng) ** 2; if (d < bd) { bd = d; best = f; } }
        if (!best) return { error: 'no_destination' };
        to = { lat: best.lat, lng: best.lng, name: best.name };
      }
      const r = await ctx.svc.eoRoute.assessRoute(from, to);
      return { verdict: r.verdict, distanceKm: r.distanceKm, destination: to.name || 'destination', reason: r.worst && r.worst.reason };
    },
  },
  get_emergency_help: {
    decl: {
      name: 'get_emergency_help',
      description: "For a life-threatening emergency (ambulance, fire, police, rescue). Returns the national emergency number and the nearest relevant facility to the caller's GPS location. Use IMMEDIATELY for 'send an ambulance', 'there is a fire', etc.",
      parameters: { type: 'object', properties: { type: { type: 'string', description: 'ambulance | fire | police | rescue' } } },
    },
    async run(args, ctx) {
      const kindMap = { ambulance: ['hospital', 'clinic'], fire: ['fire_station'], police: ['police'], rescue: ['hospital', 'police'] };
      const kinds = kindMap[args.type] || ['hospital'];
      const c = (Number.isFinite(ctx.lat) && Number.isFinite(ctx.lng)) ? { lat: ctx.lat, lng: ctx.lng } : null;
      return {
        emergencyNumber: '112',
        callerLocation: ctx.place || (c ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : 'unknown — ask the caller'),
        haveGps: !!c,
        nearest: c ? nearest(ctx.svc.store.getFacilities(), c.lat, c.lng, kinds) : [],
        note: 'LocalPulse is not an emergency dispatcher. Tell the caller to call 112 now; you can also log a located community alert if they confirm.',
      };
    },
  },
  // --- Write actions (confirmation-gated; auto-fill location from GPS) ---
  file_report: {
    write: true,
    decl: {
      name: 'file_report',
      description: "File a community incident report at the caller's location (visible to responders). ALWAYS describe it and ask the caller to confirm first; only call with confirmed=true after they say yes.",
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'road | power | water | medical | shelter | other' },
          message: { type: 'string' },
          severity: { type: 'string', description: 'low | medium | high' },
          confirmed: { type: 'boolean' },
        },
        required: ['category', 'message'],
      },
    },
    async run(args, ctx) {
      const summary = `Report (${args.category || 'other'}): ${String(args.message || '').slice(0, 120)} at ${ctx.place || 'your location'}`;
      if (!args.confirmed) return { committed: false, pending: { kind: 'file_report', summary }, ask: `I will file this: "${summary}". Shall I send it?` };
      const report = {
        category: String(args.category || 'other').slice(0, 24),
        message: String(args.message || '').slice(0, 500),
        severity: ['low', 'medium', 'high'].includes(args.severity) ? args.severity : 'medium',
        lang: ctx.lang, lat: Number.isFinite(ctx.lat) ? ctx.lat : null, lng: Number.isFinite(ctx.lng) ? ctx.lng : null,
        place: ctx.place || null, createdAt: Date.now(), status: 'unverified', src: 'voice',
      };
      let id = null;
      try { id = await ctx.svc.persist.addReport(report); } catch { /* best-effort */ }
      id = id || ('voice-' + Date.now().toString(36));
      try { ctx.svc.store.addCommunityReport(ctx.svc.ingest.reportToIncident({ id, ...report })); } catch { /* ignore */ }
      return { committed: true, id, summary };
    },
  },
  post_im_safe: {
    write: true,
    decl: {
      name: 'post_im_safe',
      description: "Post an 'I am safe' beacon for the caller (matched against missing-person searches). Confirm first; call with confirmed=true after the caller agrees.",
      parameters: { type: 'object', properties: { name: { type: 'string' }, confirmed: { type: 'boolean' } } },
    },
    async run(args, ctx) {
      const summary = `Mark ${args.name || 'caller'} as safe at ${ctx.place || 'your location'}`;
      if (!args.confirmed) return { committed: false, pending: { kind: 'post_im_safe', summary }, ask: `Shall I post that ${args.name || 'you'} are safe?` };
      const item = { kind: 'safe', message: "I'm safe", name: String(args.name || '').slice(0, 40), lat: Number.isFinite(ctx.lat) ? ctx.lat : null, lng: Number.isFinite(ctx.lng) ? ctx.lng : null, createdAt: Date.now() };
      let id = null;
      try { id = await ctx.svc.persist.addAid(item); } catch { /* ignore */ }
      return { committed: true, id, summary };
    },
  },
  register_missing: {
    write: true,
    decl: {
      name: 'register_missing',
      description: 'Register a missing person so they can be matched with safe check-ins. Confirm the details first; call with confirmed=true after the caller agrees.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, lastSeen: { type: 'string' }, contact: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['name'] },
    },
    async run(args, ctx) {
      const summary = `Missing person: ${String(args.name || '').slice(0, 60)}${args.lastSeen ? ', last seen ' + String(args.lastSeen).slice(0, 60) : ''}`;
      if (!args.confirmed) return { committed: false, pending: { kind: 'register_missing', summary }, ask: `Shall I register this missing person: ${summary}?` };
      const item = { name: String(args.name || '').slice(0, 80), lastSeen: String(args.lastSeen || '').slice(0, 120), note: '', contact: String(args.contact || '').slice(0, 40), createdAt: Date.now() };
      let id = null;
      try { id = await ctx.svc.persist.addMissing(item); } catch { /* ignore */ }
      return { committed: true, id, summary };
    },
  },
};

function toolDeclarations() { return [{ functionDeclarations: Object.values(TOOLS).map((t) => t.decl) }]; }

function systemInstruction(lang, ctx) {
  return [
    `You are LocalPulse, a calm, decisive crisis-support voice assistant for ${process.env.LOCATION_QUERY || 'Solan, Himachal Pradesh'}, India.`,
    `Speak in ${LANG_NAME[lang] || 'English'}. Reply in 1 to 3 short, natural spoken sentences. No markdown, no lists, no emojis. It is read aloud.`,
    'Decide which tools to call to answer with real live data; you may call several. Never invent incidents, facilities or numbers.',
    "When the caller says 'my location', 'here', 'me', or 'send help to me', use their GPS coordinates automatically (already provided) without asking them to read out coordinates.",
    'If the situation is life-threatening, first tell them to call 112, then give the nearest facility and their location.',
    'To take an action (file_report, post_im_safe, register_missing), FIRST tell the caller exactly what you will do and ask them to confirm. Only call the action with confirmed=true after they clearly agree. Never act without confirmation.',
    ctx && ctx.contextLine ? `Caller context: ${ctx.contextLine}` : '',
  ].filter(Boolean).join(' ');
}

// Default Gemini transport. Returns the model `content` object ({ role, parts }) or null.
async function defaultCallModel({ contents, tools, system }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 512 },
  };
  if (tools) body.tools = tools;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 18000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j.candidates && j.candidates[0] && j.candidates[0].content ? j.candidates[0].content : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

function clampHistory(history) {
  const h = Array.isArray(history) ? history.filter((m) => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string') : [];
  return h.slice(-MAX_HISTORY);
}

async function buildContext({ lat, lng, place, lang, svc }) {
  const ctx = { lat, lng, place: place || null, lang, svc };
  // Automate fetching baseline info so the agent starts informed (best-effort, no model call).
  try {
    if (!ctx.place && Number.isFinite(lat) && Number.isFinite(lng)) {
      const p = await svc.geolocate.reverseGeocode(lat, lng);
      if (p && p.place) ctx.place = p.place;
    }
  } catch { /* ignore */ }
  try {
    const a = svc.store.getAssessment ? svc.store.getAssessment() : null;
    const near = (Number.isFinite(lat) && Number.isFinite(lng)) ? nearest(svc.store.getFacilities(), lat, lng, ['hospital', 'clinic'])[0] : null;
    ctx.contextLine = [ctx.place ? `location ${ctx.place}` : null, a && a.level ? `current risk ${a.level}` : null, near ? `nearest hospital ${near.name}` : null].filter(Boolean).join('; ') || null;
  } catch { ctx.contextLine = null; }
  return ctx;
}

/**
 * Run one conversational turn.
 * @param {object} p { q, history, lat, lng, place, lang }
 * @param {object} deps optional { callModel, services } for tests
 * @returns {Promise<null|{answer,history,used,pendingAction}>} null => caller should fall back to the keyword bot
 */
async function converse(p, deps = {}) {
  const callModel = deps.callModel || defaultCallModel;
  const q = String((p && p.q) || '').trim().slice(0, 400);
  const lang = (p && LANG_NAME[p.lang]) ? p.lang : 'en';
  if (!q) return null;
  // No model available and no test transport -> signal fallback to the free keyword bot.
  if (!deps.callModel && !process.env.GEMINI_API_KEY) return null;
  if (!budgetOk()) return { answer: 'The helpline is very busy right now. For an emergency call 112. Otherwise please try again shortly.', history: clampHistory(p.history), used: [], pendingAction: null };
  count += 1;

  const svc = deps.services || realServices();
  const ctx = await buildContext({ lat: p && p.lat, lng: p && p.lng, place: p && p.place, lang, svc });
  const system = systemInstruction(lang, ctx);
  const history = clampHistory(p && p.history);
  const contents = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  contents.push({ role: 'user', parts: [{ text: q }] });

  const used = [];
  let pendingAction = null;
  let answer = '';

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const content = await callModel({ contents, tools: toolDeclarations(), system });
    if (!content) return deps.callModel ? null : fallbackAnswer(history, q, lang);
    contents.push(content);
    const calls = (content.parts || []).filter((x) => x.functionCall).map((x) => x.functionCall);
    if (!calls.length) {
      answer = (content.parts || []).map((x) => x.text).filter(Boolean).join(' ').trim();
      break;
    }
    const responses = await Promise.all(calls.map(async (c) => {
      const tool = TOOLS[c.name];
      let result;
      if (!tool) { result = { error: 'unknown_tool' }; } else {
        used.push(c.name);
        try { result = await tool.run(c.args || {}, ctx); } catch { result = { error: 'tool_failed' }; }
        if (result && result.pending) pendingAction = result.pending;
      }
      return { functionResponse: { name: c.name, id: c.id, response: result } };
    }));
    contents.push({ role: 'user', parts: responses });
  }

  if (!answer) {
    // Out of steps (or only tool calls) — ask for a final spoken answer with tools off.
    const fin = await callModel({ contents, tools: null, system });
    answer = fin ? (fin.parts || []).map((x) => x.text).filter(Boolean).join(' ').trim() : '';
  }
  if (!answer) answer = 'I could not work that out just now. For an emergency call 112, or check the live status on screen.';
  answer = answer.slice(0, 700);
  const outHistory = [...history, { role: 'user', text: q }, { role: 'model', text: answer }].slice(-MAX_HISTORY);
  return { answer, history: outHistory, used, pendingAction };
}

function fallbackAnswer(history, q, _lang) {
  return null; // real-mode model failure -> let the endpoint fall back to the keyword bot
}

module.exports = { converse, TOOLS, toolDeclarations, systemInstruction, _MODEL: MODEL };
