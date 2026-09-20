# Bob

An ambient voice agent for EF Education First: it listens to a conversation
continuously and only speaks when someone addresses it directly or it judges
it has something genuinely important to add — not after every sentence.
Modeled as a real EF team member with opinions, not a generic assistant.

Bob understands whatever language he's spoken to, but always replies in
English. Everything he hears and says is remembered across sessions, and
every decision he makes about whether to speak is logged, categorized, and
reviewable.

## Quick start

Two processes, front-end and back-end:

```bash
# terminal 1
cd server
cp .env.example .env   # optional — see "Configuration" below
npm install
npm run dev             # http://localhost:8787

# terminal 2
npm install
npm run dev              # http://localhost:5173
```

Open `http://localhost:5173`, turn the mic on, and talk. Say "Bob" in a
sentence to trigger his instant direct-address path.

**Works out of the box with zero API keys** — every provider (gate decision,
response generation, transcription) falls back to a deterministic mock so
the whole pipeline is testable immediately. Add keys to `server/.env` to
switch on real models; see below for which key unlocks what.

No microphone handy, or want to see the app full of realistic data in one
click? Use the **"Load demo meeting"** button in the control bar — it
replays a scripted 4-person business meeting through the real gate/response
pipeline (text only, no audio) and populates the Dashboard, Workshop, and
Notes tabs with genuine output.

## What it does

- **Ambient listening, not turn-by-turn chat.** Bob evaluates every
  utterance and only speaks for one of two reasons: someone addressed him
  directly ("Bob, ...") or the gate judges the moment worth an unprompted
  opinion. Everything else, he stays silent for.
- **Automatic language understanding, fixed English output.** No manual
  language picker — Bob reads whatever language the room speaks and always
  answers in English.
- **Persistent memory.** Every utterance (human or Bob) is written to a
  local SQLite database as it happens, so a page refresh or a server
  restart doesn't lose the conversation.
- **Four tabs**, all driven by real data, none of it hand-authored:
  - **Conversation** — the live transcript and the gate's decision log.
    Every "human" line can be named (click it) so summaries and exports
    say "Sarah" instead of a generic "You" — see "Speaker identification"
    below for the automatic version.
  - **Dashboard** — session analytics: response rate, latency, a
    category breakdown, an activity timeline, the full decision log.
  - **Workshop** — every decision this session, triaged into a kanban
    board by category (direct address / important info / nothing to say),
    sortable and filterable.
  - **Notes** — one-click AI summary with key points and action items in
    one of four formats (business meeting, lecture, interview, to-do
    list — each changes what counts as a "key point" or "action item",
    not just the wording), an AI-generated mind map of the conversation's
    topic hierarchy, "Ask Bob" (queries his full persistent memory, not
    just what's on screen), full-text memory search, and export (text
    download or print-to-PDF, both include the mind map as an indented
    outline).

## Two voice pipelines, automatic switch

`App.tsx` checks the server's `/api/health` response and picks one:

- **Realtime pipeline** (`useBobRealtime.ts`) — used automatically when
  `OPENAI_API_KEY` is set. Built on OpenAI's Realtime API over WebRTC: real
  hardware-level echo cancellation (Bob genuinely stops hearing his own
  voice), native server-side interruption, native multilingual
  transcription (Whisper). Our own `/api/gate` call still decides *whether*
  Bob should speak — the Realtime session's own auto-response is disabled;
  once the gate says yes, `response.create` tells the model to generate and
  speak the reply in one step.
- **Legacy pipeline** (`useBobOrchestrator.ts`) — the fallback when no
  OpenAI key is configured. Browser `SpeechRecognition`/`SpeechSynthesis` +
  a separate Whisper-via-Groq upload for real multilingual transcription,
  with text-similarity heuristics for barge-in/echo detection since the
  browser has no real echo cancellation.

Both pipelines share the same gate/response REST cascade, the same
persona, the same persistent memory, and the same four tabs — only the
audio layer differs.

## Speaker identification

There's no acoustic speaker separation live in the conversation — every
human voice is recorded as one undifferentiated `"human"` speaker (see
`types.ts`). Two ways to attach real names on top of that:

- **Manual (always available, either pipeline).** Click any human line in
  the Conversation tab to name it. Persists to the database immediately
  (`PATCH /api/memory/:id/label`), so it survives a refresh, and flows into
  summaries, mind maps, and exports from then on.
- **Automatic ("Identify speakers" button, legacy pipeline only, needs
  `DEEPGRAM_API_KEY`).** Diarizes the whole session's recording in one call
  and fills in "Speaker 1" / "Speaker 2" placeholders on whichever human
  lines nobody's already named — click one afterward to give it a real
  name, same as manual tagging. Two things worth knowing before relying on
  this:
  - **It's a one-shot, whole-session call, not live.** Diarization only
    stays consistent across turns within one continuous audio file —
    Bob records each utterance as its own independent clip (for Whisper),
    and separate diarization requests over separate clips would each
    restart speaker numbering from zero with no way to agree with each
    other. So a second, never-cut recording runs in parallel
    (`useAudioCapture.ts`'s `getFullRecording`) purely for this, and
    clicking "Identify speakers" re-sends the whole session so far —
    it does cost more per click on a long session, and is why this isn't
    automatic or live.
  - **Legacy pipeline only.** The Realtime pipeline's audio is a direct
    WebRTC connection between the browser and OpenAI — it never passes
    through this app's server, so there's nothing here to diarize on that
    path. The button only appears when the legacy pipeline is active.
  - The Deepgram request/response integration itself (auth, `diarize=true`
    + `utterances=true`, parsing) was verified against the real API and
    returns exactly the shape this app expects. What's *not* verified:
    real-world accuracy with actual distinct human voices in a live
    meeting — that needs testing with real speech, not something that can
    be confirmed from this environment.

## Provider cascade

Every AI call degrades gracefully instead of hard-failing: each tier is
tried in order, falls through to the next on error or a missing key, and
the last resort is always a deterministic mock so the app never breaks.

| Call | 1st choice | 2nd choice | Last resort |
|---|---|---|---|
| Gate (should Bob speak?) | Groq (free) | GLM-5.3-Flash | mock heuristic |
| Response generation | Claude Sonnet 5 | Groq (free) | mock template |
| Summary / Ask Bob | Claude Sonnet 5 | Groq (free) | mock |
| Transcription (legacy pipeline) | Groq Whisper | — | browser's own STT |
| Full voice pipeline | OpenAI Realtime | — | legacy pipeline above |

`/api/health` reports which provider is actually active for the gate and
for response generation — shown live in the Dashboard's System Status
panel.

## Configuration

All in `server/.env` (see `server/.env.example`):

| Variable | Unlocks | Required? |
|---|---|---|
| `GROQ_API_KEY` | Free gate + free response fallback + Whisper transcription | No — mock fallback |
| `ZHIPU_API_KEY` | GLM-5.3-Flash gate (paid, lower priority than Groq) | No |
| `ANTHROPIC_API_KEY` | Claude Sonnet 5 for responses/summaries (best quality) | No |
| `OPENAI_API_KEY` | Switches the whole voice pipeline to the Realtime API | No — falls back to legacy |
| `OPENAI_REALTIME_MODEL` | Override the Realtime model (default `gpt-realtime`) | No |
| `DEEPGRAM_API_KEY` | "Identify speakers" — automatic diarization over the session's recording (legacy pipeline only, see "Speaker identification" below) | No — manual tagging (click a name onto a line) works without it |
| `PORT` | Backend port (default `8787`) | No |
| `CORS_ORIGIN` | Restrict the API to one front-end origin in production | No — wide open by default for local dev |
| `TRUST_PROXY` | Set `true` if deployed behind a reverse proxy/load balancer, so rate limiting keys on the real client IP instead of the proxy's | No |
| `PERSONA_FILE` | Swap the persona file (default `bob-prompt.md`) — see "White-labeling" | No |

Front-end build-time config lives in the root `.env` (see root
`.env.example`) — `VITE_API_BASE_URL`, `VITE_AGENT_NAME`, `VITE_TAGLINE`.
These are read by Vite at build time, not runtime.

## Production hardening

- **Rate limiting** (`server/rateLimiter.mjs`) — an in-memory per-IP limiter
  on every route that calls a paid API: a generous cap on the routes that
  fire continuously during a live session (gate, respond, transcribe), a
  tighter cap on manual one-click actions (summary, ask). Protects against
  a runaway client or abuse burning through the configured API keys'
  budget.
- **Input caps** — every client-supplied field that scales with
  conversation length (transcript arrays, utterance text, questions) is
  clamped server-side, independent of whatever the front-end already does,
  since the server should never assume a request actually came from its
  own client.
- **CORS** — wide open by default so the zero-config local dev setup above
  keeps working; set `CORS_ORIGIN` to the deployed front-end's origin in
  production.

## Testing

```bash
cd server
npm test
```

Node's built-in test runner (`node --test`), zero extra dependency. Covers
the logic that's actually broken in practice during real use — SQLite
persistence and its full-text search (including LIKE-wildcard escaping) and
speaker labels, the rate limiter's per-IP/per-window behavior, the
diarization timestamp-matching logic (nearest diarized segment by midpoint
distance — see "Speaker identification"), and structural regression tests
on every system prompt (the gate's three-category contract, the "don't
fabricate an action item for something already done" rule, "Bob's own
advice belongs to the human, not to Bob," the anti-repetition and
no-fake-commitments rules, and the per-template summary/mind-map prompts).
These specific assertions exist because each one was a real bug found by
hand during development — the tests lock in the fix so a future prompt
edit can't silently reintroduce it.
`server/test/*.test.mjs`; `DB_PATH` is overridden to a throwaway temp file
so tests never touch real conversation data.

There's no front-end test suite yet — the client-side logic most worth
covering (`isDirectAddress`, `useCountUp`'s easing math) is plain
TypeScript with no framework dependency, so adding one later is mechanical
(any TS-aware runner — Vitest is the natural fit alongside Vite).

## White-labeling

Everything needed to resell this under a different name/brand is
consolidated into a few places — no hunting through components:

| What | Where | How |
|---|---|---|
| Agent's personality | `server/bob-prompt.md` | Edit directly, or point `PERSONA_FILE` (in `server/.env`) at a different file — `server/personas/generic-example.md` is a ready-to-customize starting point that doesn't claim to be any specific real company. |
| Agent's display name & tagline | `VITE_AGENT_NAME`, `VITE_TAGLINE` (root `.env`, read at build time) | Every UI string ("Bob's voice," "Ask Bob," etc.) is built from these — nothing is hardcoded in components. |
| Brand colors | `src/App.css`, the `:root` custom properties (`--accent`, `--brand-gradient`, etc.) | These are EF's actual pink/purple by default — change them before shipping to a different brand. |
| Export filenames | Derived from `VITE_AGENT_NAME` automatically | No separate config. |

The bundled defaults (EF Education First persona, "Bob," the EF color
palette) are exactly what this app was built for — nothing changes unless
you explicitly override the variables above.

## Deployment

This is a **single-tenant app**: no accounts, no login, one shared memory.
Each customer gets their own deployment (their own front-end + back-end +
API keys), not a shared multi-user instance — see "Known limitations"
below for what that does and doesn't mean.

**Front-end (Netlify or any static host).** `netlify.toml` at the repo
root already points Netlify at `npm run build` / `dist`. Set
`VITE_API_BASE_URL` in Netlify's build environment settings to wherever
the back-end ends up (see below) — without it, API calls stay relative and
only work when front-end and back-end share one origin.

**Back-end (any host that runs a persistent Node process — Railway,
Render, Fly.io, a VPS).** `server/package.json`'s `start` script
(`node index.mjs`) and `PORT` handling already work with these platforms'
usual conventions; there's no platform-specific config file to write.
Two things that matter once it's actually live, not just running:

- Set `CORS_ORIGIN` to the deployed front-end's exact URL (leaving it
  wide open in production defeats the point of setting it).
- **The SQLite file needs a persistent disk.** Most PaaS filesystems are
  ephemeral by default — the database (and "everything Bob remembers")
  gets wiped on every redeploy unless the host's persistent volume/disk
  feature is enabled and `DB_PATH` (or the default `server/data/`) is
  mounted on it. This is easy to miss and only shows up as "why did Bob
  forget everything" after the first redeploy.

## Known limitations

- **No accounts, no billing.** By design for now — see "Deployment"
  above. Adding either is a real, separate project (auth, multi-tenant
  data isolation, a payment provider), not a quick extension of what's
  here.
- `node:sqlite` is an experimental Node API (logged as a warning on
  startup) — stable enough for this use case, but worth knowing before
  deploying somewhere that pins older Node versions.
- Real provider API calls (Groq, GLM, Anthropic, OpenAI) have not been
  load-tested against a live production account — verify current pricing
  and rate limits with each provider before relying on this at scale.
- The person who deploys this pays for its own API usage (Groq/Anthropic/
  OpenAI/Deepgram) — that cost is not built into anything here and needs to
  be accounted for separately from whatever this software itself is sold
  for.
- Automatic diarization ("Identify speakers") is a one-shot call over the
  whole session, legacy pipeline only, and its integration with Deepgram's
  API was verified end-to-end (auth, request shape, response parsing all
  confirmed against the real API) — but real-world accuracy with actual
  distinct human voices has not been, since generating genuinely distinct
  human-like test voices isn't something possible from this environment.
  See "Speaker identification" above; manual tagging (click a line, type a
  name) works regardless and needs no key.

## Structure

```
src/
  hooks/useBobRealtime.ts       Realtime API pipeline (WebRTC)
  hooks/useBobOrchestrator.ts   Legacy pipeline (browser STT/TTS + Whisper)
  lib/directAddress.ts          "Bob, ..." detection (fast, deterministic)
  lib/gateClient.ts             /api/gate
  lib/responseClient.ts         /api/respond (streaming)
  lib/demoSimulation.ts         replays data/demoMeeting.ts through the real pipeline
  lib/insightsClient.ts         /api/summary, /api/ask, /api/memory/search
  lib/diarizeClient.ts          /api/diarize — see "Speaker identification"
  lib/mindmapOutline.ts         mind map tree -> indented text, for export
  lib/apiBase.ts                resolves API calls against VITE_API_BASE_URL
  lib/branding.ts               VITE_AGENT_NAME / VITE_TAGLINE — see "White-labeling"
  components/                   Dashboard, Workshop, Notes, MindMap, transcript, controls
server/
  index.mjs                     routes, provider cascades, rate limiting, CORS
  rateLimiter.mjs               in-memory per-IP request limiter
  memory.mjs                    SQLite persistence + full-text search + speaker labels
  persona.mjs                   Bob's character (bob-prompt.md) + all system prompts
  personas/generic-example.md   a non-EF-specific persona starting point
  providers/                    gate.mjs, groq.mjs, respond.mjs, insights.mjs, whisper.mjs, deepgram.mjs
  test/                         node --test suite — see "Testing"
```
