import "dotenv/config";
import cors from "cors";
import express from "express";
import { glmGate, mockGate } from "./providers/gate.mjs";
import { groqGate, groqRespond } from "./providers/groq.mjs";
import { mockRespond, sonnetRespond } from "./providers/respond.mjs";
import { transcribeAudio } from "./providers/whisper.mjs";
import { diarizeAudio, matchUtterancesToSpeakers } from "./providers/deepgram.mjs";
import { getMemoryStats, getRecentUtterances, labelUtterance, recordUtterance, resetMemory, searchMemory } from "./memory.mjs";
import {
  groqAsk,
  groqMindmap,
  groqSummary,
  mockAsk,
  mockMindmap,
  mockSummary,
  sonnetAsk,
  sonnetMindmap,
  sonnetSummary,
} from "./providers/insights.mjs";
import { realtimeInstructions } from "./persona.mjs";
import { rateLimit } from "./rateLimiter.mjs";
import { timeoutSignal } from "./withTimeout.mjs";

const PORT = process.env.PORT || 8787;
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
// Wide open by default so the zero-config local dev setup (README) keeps
// working out of the box — set this in production so the API only answers
// requests from the actual deployed front-end's origin.
const CORS_ORIGIN = process.env.CORS_ORIGIN || true;

const app = express();
// If this ever sits behind a reverse proxy (nginx, a PaaS load balancer),
// req.ip below would otherwise resolve to the proxy's address for every
// request, making the rate limiter apply to everyone as one shared bucket.
app.set("trust proxy", process.env.TRUST_PROXY === "true");
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// "Hot path" routes fire continuously during an active session (one gate
// call per utterance, easily one every few seconds in a real meeting) — the
// cap is generous. "On demand" routes are manual, one-click user actions
// (generate summary, ask a question), so a much tighter cap still never
// gets in a real user's way while still bounding worst-case API spend.
const hotPathLimit = rateLimit("hot", { max: 120, windowMs: 60_000 });
const onDemandLimit = rateLimit("on-demand", { max: 20, windowMs: 60_000 });

function gateProviderName() {
  if (GROQ_API_KEY) return "groq";
  if (ZHIPU_API_KEY) return "glm-5.3-flash";
  return "mock";
}

function respondProviderName() {
  if (ANTHROPIC_API_KEY) return "claude-sonnet-5";
  if (GROQ_API_KEY) return "groq";
  return "mock";
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    gate: gateProviderName(),
    respond: respondProviderName(),
    realtimeAvailable: Boolean(OPENAI_API_KEY),
    diarizeAvailable: Boolean(DEEPGRAM_API_KEY),
  });
});

// Mints a short-lived client secret the browser uses to open a WebRTC
// connection directly to OpenAI's Realtime API — the real OPENAI_API_KEY
// never leaves this server. See useBobRealtime.ts for how it's used.
//
// The full session config (persona, forced English, manual response
// control) is baked in HERE, at mint time, not pushed as a client-side
// override after connecting: OpenAI creates a real session object the
// moment the token is minted (its defaults were showing up live — a
// generic "AI buddy" persona replying in whatever language, auto-speaking
// without our gate ever running), and the client's post-connect config
// push wasn't reliably overriding that baseline. Configuring it up front
// removes that race entirely.
app.post("/api/realtime-token", hotPathLimit, async (req, res) => {
  if (!OPENAI_API_KEY) {
    res.status(503).json({ error: "OPENAI_API_KEY not configured" });
    return;
  }
  const voice = req.body?.voice || "cedar";
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: realtimeInstructions(),
          audio: {
            input: {
              transcription: { model: "whisper-1" },
              // Raw REST API, snake_case — this is not the SDK, which
              // accepts camelCase and translates it itself.
              turn_detection: {
                type: "server_vad",
                create_response: false,
                interrupt_response: true,
              },
            },
            output: { voice },
          },
        },
      }),
      signal: timeoutSignal(8000),
    });
    if (!r.ok) {
      throw new Error(`realtime token mint failed: ${r.status} ${await r.text()}`);
    }
    const data = await r.json();
    res.json({ value: data.value, expiresAt: data.expires_at });
  } catch (err) {
    console.error("realtime token mint failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// The client still builds its own RealtimeAgent with these same
// instructions as a redundant safety net — if the client-side config push
// ever does successfully apply (see the note above), it should reinforce
// the same persona rather than overwrite it with something generic.
app.get("/api/realtime/instructions", (_req, res) => {
  res.json({ instructions: realtimeInstructions() });
});

// Persistent memory: every utterance (human or Bob) gets written here as it
// happens, and the front-end reloads recent history on startup so Bob's
// memory survives a browser refresh or a server restart, not just the
// current in-memory session.
app.post("/api/memory", (req, res) => {
  const { speaker, text, lang } = req.body ?? {};
  if (!speaker || !text) {
    res.status(400).json({ error: "speaker and text are required" });
    return;
  }
  if (typeof text !== "string" || text.length > 4000) {
    res.status(400).json({ error: "text must be a string of at most 4000 characters" });
    return;
  }
  const id = recordUtterance({ speaker, text, lang });
  res.status(201).json({ id });
});

// Retroactively names who said a given line — there's no automatic speaker
// separation (see memory.mjs), so this is how manual tagging (a click on a
// name in the transcript, see TranscriptFeed.tsx) actually gets persisted.
app.patch("/api/memory/:id/label", onDemandLimit, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid utterance id" });
    return;
  }
  const label = String(req.body?.label ?? "").trim().slice(0, 80);
  if (!label) {
    res.status(400).json({ error: "label is required" });
    return;
  }
  labelUtterance(id, label);
  res.status(204).end();
});

app.get("/api/memory/recent", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json(getRecentUtterances(limit));
});

// Backs the "search memory" box in the Notes tab — a substring search
// across everything Bob has ever heard or said, not just the current
// session's transcript.
app.get("/api/memory/search", (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) {
    res.json([]);
    return;
  }
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  res.json(searchMemory(query, limit));
});

// All-time counts, not scoped to the current browser session — feeds the
// dashboard's memory tile.
app.get("/api/memory/stats", (_req, res) => {
  res.json(getMemoryStats());
});

// Wipes Bob's memory so the next reload starts a clean conversation. The
// confirmation dialog lives client-side (see App.tsx) — this endpoint just
// does what it's told.
app.delete("/api/memory", (_req, res) => {
  resetMemory();
  res.status(204).end();
});

// Real multilingual transcription (see providers/whisper.mjs) — the client
// sends raw recorded audio for one utterance, we forward it to Groq's
// Whisper. Falls back to a 503 if no GROQ_API_KEY is set; the client keeps
// using the browser's own (single-language) transcription in that case.
app.post("/api/transcribe", hotPathLimit, express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
  if (!GROQ_API_KEY) {
    res.status(503).json({ error: "Transcription requires GROQ_API_KEY" });
    return;
  }
  try {
    const mimeType = req.headers["content-type"] || "audio/webm";
    const result = await transcribeAudio(req.body, mimeType, GROQ_API_KEY);
    res.json(result);
  } catch (err) {
    console.error("transcription failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// One-shot speaker diarization over the whole session's continuous
// recording so far (see useAudioCapture.ts's getFullRecording and
// providers/deepgram.mjs) — an explicit, occasional, user-triggered action
// ("Identify speakers" in the transcript panel), not something that runs
// per-utterance. Only fills in "human" lines nobody has already manually
// named (see TranscriptFeed.tsx's click-to-name), and only on the legacy
// pipeline — the Realtime pipeline's WebRTC audio never passes through this
// server, so there's no recording here to diarize on that path.
app.post(
  "/api/diarize",
  onDemandLimit,
  express.raw({ type: "*/*", limit: "150mb" }),
  async (req, res) => {
    if (!DEEPGRAM_API_KEY) {
      res.status(503).json({ error: "Diarization requires DEEPGRAM_API_KEY" });
      return;
    }
    const sessionStartTs = Number(req.query.sessionStartTs);
    if (!Number.isFinite(sessionStartTs) || sessionStartTs <= 0) {
      res.status(400).json({ error: "sessionStartTs query param is required" });
      return;
    }
    try {
      const mimeType = req.headers["content-type"] || "audio/webm";
      const segments = await diarizeAudio(req.body, mimeType, DEEPGRAM_API_KEY);
      const rows = getRecentUtterances(500).filter((r) => r.speaker === "human" && !r.speakerLabel);
      const matches = matchUtterancesToSpeakers(rows, segments, sessionStartTs);
      const speakerSet = new Set();
      for (const m of matches) {
        speakerSet.add(m.speaker);
        // Placeholder names, not real ones — Deepgram has no idea who
        // "speaker 0" actually is. Someone renames these afterward with
        // the same click-to-name control manual tags already use.
        labelUtterance(m.id, `Speaker ${m.speaker + 1}`);
      }
      res.json({ speakers: speakerSet.size, labeled: matches.length });
    } catch (err) {
      console.error("diarization failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// Groq (free, fast) is tried first for the gate since that's exactly the
// role it's suited for; GLM is the paid fallback if a Zhipu key is set but
// Groq isn't, and mock is the last resort so the app never breaks.
// Defensive server-side cap on the two client-supplied fields that scale
// with conversation length — the client already windows to the last 10
// turns, but the server shouldn't trust that a request actually came from
// this app's own front-end.
function clampConversationInput(body) {
  const recentTranscript = Array.isArray(body?.recentTranscript) ? body.recentTranscript.slice(-10) : [];
  const latestUtterance = typeof body?.latestUtterance === "string" ? body.latestUtterance.slice(0, 2000) : "";
  return { ...body, recentTranscript, latestUtterance };
}

app.post("/api/gate", hotPathLimit, async (req, res) => {
  req.body = clampConversationInput(req.body);
  try {
    let decision;
    if (GROQ_API_KEY) {
      try {
        decision = await groqGate(req.body, GROQ_API_KEY);
      } catch (err) {
        console.error("Groq gate failed, falling back:", err.message);
      }
    }
    if (!decision && ZHIPU_API_KEY) {
      try {
        decision = await glmGate(req.body, ZHIPU_API_KEY);
      } catch (err) {
        console.error("GLM gate failed, falling back to mock heuristic:", err.message);
      }
    }
    if (!decision) decision = await mockGate(req.body);
    res.json(decision);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sonnet 5 first (best quality, matches the EF persona best), Groq as a
// free fallback, mock as the last resort.
app.post("/api/respond", hotPathLimit, async (req, res) => {
  req.body = clampConversationInput(req.body);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");

  // NB: `req.on("close")` fires as soon as the request body is fully read,
  // which happens right away for small JSON bodies — long before the client
  // actually disconnects. We must watch the *response* socket instead, and
  // only treat it as a real abort if we hadn't finished writing ourselves.
  let aborted = false;
  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });
  const shouldAbort = () => aborted;
  const write = (chunk) => res.write(chunk);

  try {
    if (ANTHROPIC_API_KEY) {
      await sonnetRespond(req.body, write, ANTHROPIC_API_KEY, shouldAbort);
    } else if (GROQ_API_KEY) {
      await groqRespond(req.body, write, GROQ_API_KEY, shouldAbort);
    } else {
      await mockRespond(req.body, write, shouldAbort);
    }
  } catch (err) {
    console.error("respond failed:", err.message);
    if (!aborted) res.write(" (erreur de generation cote serveur) ");
  } finally {
    if (!aborted) res.end();
  }
});

// AI recap of a conversation (summary + key points + action items in one
// structured call) — the "Plaud-style" summarization feature, adapted for a
// live agent: it summarizes whatever transcript the client sends (normally
// the current session), not a recorded audio file. Same provider cascade as
// /api/respond: Sonnet first, Groq free fallback, mock last resort.
const SUMMARY_TEMPLATES = new Set(["meeting", "lecture", "interview", "todo"]);

app.post("/api/summary", onDemandLimit, async (req, res) => {
  const rawUtterances = Array.isArray(req.body?.utterances) ? req.body.utterances : [];
  if (rawUtterances.length === 0) {
    res.status(400).json({ error: "utterances array is required and must be non-empty" });
    return;
  }
  // Unknown/missing template silently falls back to "meeting" rather than
  // 400ing — this is a UI-driven preset, not a security boundary.
  const template = SUMMARY_TEMPLATES.has(req.body?.template) ? req.body.template : "meeting";
  // Caps both the number of lines and each line's length — a session's
  // transcript is capped client-side already (MAX_TRANSCRIPT), but this is
  // the same "don't trust the client" defensiveness as clampConversationInput.
  const utterances = rawUtterances
    .slice(0, 300)
    .map((u) => ({ speaker: u?.speaker, text: String(u?.text ?? "").slice(0, 2000) }));
  try {
    let result;
    if (ANTHROPIC_API_KEY) {
      try {
        result = await sonnetSummary(utterances, ANTHROPIC_API_KEY, template);
      } catch (err) {
        console.error("Sonnet summary failed, falling back:", err.message);
      }
    }
    if (!result && GROQ_API_KEY) {
      try {
        result = await groqSummary(utterances, GROQ_API_KEY, template);
      } catch (err) {
        console.error("Groq summary failed, falling back to mock:", err.message);
      }
    }
    if (!result) result = mockSummary(utterances, Boolean(ANTHROPIC_API_KEY || GROQ_API_KEY));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI-generated topic hierarchy — same idea as /api/summary but shaped as a
// tree instead of a flat recap, rendered by the client as a diagram (see
// MindMap.tsx). Same provider cascade, same input clamp.
app.post("/api/mindmap", onDemandLimit, async (req, res) => {
  const rawUtterances = Array.isArray(req.body?.utterances) ? req.body.utterances : [];
  if (rawUtterances.length === 0) {
    res.status(400).json({ error: "utterances array is required and must be non-empty" });
    return;
  }
  const utterances = rawUtterances
    .slice(0, 300)
    .map((u) => ({ speaker: u?.speaker, text: String(u?.text ?? "").slice(0, 2000) }));
  try {
    let result;
    if (ANTHROPIC_API_KEY) {
      try {
        result = await sonnetMindmap(utterances, ANTHROPIC_API_KEY);
      } catch (err) {
        console.error("Sonnet mindmap failed, falling back:", err.message);
      }
    }
    if (!result && GROQ_API_KEY) {
      try {
        result = await groqMindmap(utterances, GROQ_API_KEY);
      } catch (err) {
        console.error("Groq mindmap failed, falling back to mock:", err.message);
      }
    }
    if (!result) result = mockMindmap(utterances, Boolean(ANTHROPIC_API_KEY || GROQ_API_KEY));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Splits a question into search terms so "what did we decide about the
// Berlin trip" can find memory rows even though the question itself never
// appears verbatim in what was said. Short/common words are dropped so the
// search doesn't drown in noise.
const ASK_STOPWORDS = new Set([
  "what", "when", "where", "which", "who", "whom", "does", "did", "the", "and", "for",
  "about", "with", "that", "this", "have", "has", "was", "were", "said", "tell", "bob",
]);
function extractSearchTerms(question) {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !ASK_STOPWORDS.has(w))
  )];
}

// "Ask Bob" — answers a question against Bob's persistent memory instead of
// only the current session's transcript, since that's the whole point of
// having persistent memory in the first place.
app.post("/api/ask", onDemandLimit, async (req, res) => {
  const question = String(req.body?.question ?? "").trim().slice(0, 500);
  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  try {
    const terms = extractSearchTerms(question);
    const matches = new Map();
    for (const term of terms) {
      for (const row of searchMemory(term, 15)) matches.set(row.id, row);
    }
    // No usable search terms, or none matched — fall back to whatever's most
    // recent so the feature still has *something* to reason over.
    const contextRows = matches.size > 0 ? [...matches.values()] : getRecentUtterances(20);

    let result;
    if (ANTHROPIC_API_KEY) {
      try {
        result = await sonnetAsk(question, contextRows, ANTHROPIC_API_KEY);
      } catch (err) {
        console.error("Sonnet ask failed, falling back:", err.message);
      }
    }
    if (!result && GROQ_API_KEY) {
      try {
        result = await groqAsk(question, contextRows, GROQ_API_KEY);
      } catch (err) {
        console.error("Groq ask failed, falling back to mock:", err.message);
      }
    }
    if (!result) result = mockAsk(question, Boolean(ANTHROPIC_API_KEY || GROQ_API_KEY));
    res.json({ ...result, sources: contextRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Bob backend sur http://localhost:${PORT}`);
  console.log(`  gate:    ${gateProviderName()}`);
  console.log(`  respond: ${respondProviderName()}`);
});
