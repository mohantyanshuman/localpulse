# Agentic Voice Helpline — Design Spec

Date: 2026-05-27
Status: Approved (build)
Author: LocalPulse

## Problem

The voice helpline (`POST /api/voice/intent` + `data/intents.js`) uses **zero LLM** —
it is keyword matching with a canned reply, lightly grounded with live data. It feels
"dumb": no real understanding, no memory, no decisions, no ability to act. Callers must
phrase things exactly, and it cannot answer "is the road to the shelter safe?" or act on
"send an ambulance to my location."

## Goal

Make the call feel like a natural, intelligent conversation that does heavy agentic
work in the background: understands free-form speech in five languages, remembers the
whole call, decides what live data to look up, reasons across satellite + ground +
official sources, uses the caller's GPS location automatically, and can take real
actions (file a report, mark "I'm safe", register a missing person) with spoken
confirmation. Must stay within free tiers (₹0): no realtime-audio API, no telephony,
no persistent sockets.

## Model

`gemini-flash-lite-latest` everywhere (env `GEMINI_MODEL`), matching `brain.js`,
`verify.js`, `assistant.js`. The voice agent uses the same constant. No other model,
no OpenAI/Whisper. STT/TTS stay on-device via the browser Web Speech API (free).

## Approach

**Gemini function-calling agent loop**, stateless server, client-held conversation memory.

Rejected alternatives: planner→executor (less adaptive); single mega-prompt RAG (not
agentic — that is today's `/api/ask`).

## API

`POST /api/voice/converse`

Request:
```
{
  q: string,                  // the caller's utterance (<= 400 chars)
  history: [{ role: 'user'|'model', text: string }],  // capped to last ~8 turns server-side
  lat?: number, lng?: number, // caller GPS (high accuracy) when granted
  place?: string,             // optional client reverse-geocode hint
  lang: 'en'|'hi'|'pa'|'ta'|'bn'
}
```

Response:
```
{
  answer: string,             // spoken-style, 1-3 sentences, in `lang`
  history: [...],             // appended (caller turn + model turn) for the client to keep
  used: string[],             // tool names invoked this turn (for the "heavy lifting" UI)
  pendingAction?: {           // when the agent is awaiting spoken confirmation for a write
    kind: 'file_report'|'post_im_safe'|'register_missing',
    summary: string
  }
}
```

Server is stateless: the client holds and resends `history` each turn (fits Cloud Run
scale-to-zero, ₹0). No session storage.

## Service: `services/voice-agent.js`

System prompt: calm, factual crisis-support assistant for the configured locality;
answer in the caller's language; **1-3 short spoken sentences, no markdown/lists** (it is
read aloud); make decisions; use ONLY tool data; if life-threatening, say call 112 first;
never invent incidents/facilities. When the caller refers to "my location / here / me",
use the provided GPS coordinates automatically.

### Tools (Gemini function declarations), each backed by existing code

Read-only:
- `get_local_risk(lat, lng)` → `dss.assess(...)` merged with `eoFusion.fuse(lat,lng)` — personalized risk + recommendations.
- `get_incidents(category?)` → `store.getIncidents()` (filtered, nearest-first when GPS present).
- `get_hazards()` → `store.getHazards()` (weather, quakes, official alerts, air quality).
- `get_satellite_assessment(lat, lng)` → `eoFusion.fuse(lat,lng)` — per-hazard levels/confidence.
- `find_facilities(kind?, lat?, lng?)` → `store.getFacilities()` — nearest hospital/clinic/police/shelter (haversine).
- `check_safe_route(fromLat, fromLng, toLat?, toLng?)` → `eoRoute.assessRoute(...)` — GO/CAUTION/NO_GO + nearest shelter snap.
- `get_emergency_help(type)` → composes 112 + nearest relevant facility (hospital/police/fire) using GPS — for "ambulance/fire/police/help to my location".

Write (require spoken confirmation; auto-fill `lat/lng/place` from GPS):
- `file_report(category, message, severity?)` → `persist.addReport` + `store.addCommunityReport(reportToIncident(...))` (same path as `/api/report`).
- `post_im_safe(name?)` → `persist.addAid({ kind:'safe', ... })`.
- `register_missing(name, lastSeen?, contact?)` → `persist.addMissing(...)`.

### Confirmation protocol (write safety)

A write tool MUST NOT commit until confirmed. The model proposes the action and asks the
caller to confirm ("I'll file a report that an ambulance is needed at <place>. Shall I send
it?"). The write tool only executes when called with `confirmed: true`, which the system
prompt instructs the model to set only after the caller agrees. The server also returns
`pendingAction` so the client can show it. Emergency *guidance* (112 + nearest hospital +
stating the GPS location) is given IMMEDIATELY without waiting on confirmation; only the
optional logging of a located alert is confirmed.

### Agentic loop

1. Build first-turn **caller context** automatically (server-side, no model round-trip):
   reverse-geocoded place (from `geolocate.reverseGeocode`), current `dss` risk level, and
   nearest hospital — so the agent starts informed ("automate fetching all information").
2. Send `q` + `history` + caller context + tool declarations to Gemini.
3. If the response contains function calls, execute them server-side (in parallel where
   independent), append `functionResponse` parts, and call again.
4. Repeat up to `VOICE_MAX_STEPS` (default 4). Final text part = `answer`.

### Guardrails (budget + security)

- Daily cap `VOICE_DAILY_CAP` (default 400) like `assistant.js`; on cap → graceful message.
- `VOICE_MAX_STEPS` per turn; `history` capped to last 8 turns; `q` <= 400 chars; per-call timeout (~18s); AbortController.
- Tools are server-side only; write tools hit the same public endpoints the web forms use (no new attack surface), are confirmation-gated, length-clamped, and audit-logged (structured stdout).
- **Graceful fallback** to the existing keyword bot (`data/intents.js`) when `GEMINI_API_KEY` is unset, the cap is hit, or any error/timeout occurs — voice keeps working free and offline-ish.
- No realtime audio, no telephony, no persistent connections → ₹0.

## Client (`public/js/voice.js`)

- On first interaction, request **high-accuracy GPS** (`enableHighAccuracy`) once; cache it; degrade gracefully if denied (agent still works, location tools just unavailable).
- Maintain a `convo` history array; `POST /api/voice/converse` with `{ q, history, lat, lng, place, lang }`; keep returned `history`.
- Render the answer, speak it (existing TTS), and surface `used[]` as a subtle "what it did" line ("checked satellite + nearest hospital + your location").
- Show `pendingAction` so a confirmation is visible, not just spoken.
- Keep `/api/voice/intent` as the documented fallback path.

## Docs cleanup

Remove the stale "Production: Twilio Voice → OpenAI Whisper" note on the voice page; the
real flow is browser Web Speech + Gemini agent. (Consistent with the report alignment.)

## Testing (`node:test`, like `test/eo`)

- Agent loop with a mocked Gemini transport: single answer; multi-step tool chain; parallel tool calls; step cap; daily-cap fallback; missing-key fallback.
- Tool dispatch maps to the right service and clamps inputs.
- Confirmation gate: write tool does not commit without `confirmed: true`.
- Location defaulting: "my location" resolves to provided GPS.

## Out of scope (explicitly)

- Gemini Live realtime audio (metered; rejected for ₹0).
- Real telephony / PSTN (paid).
- Server-side session storage (kept stateless for scale-to-zero).
