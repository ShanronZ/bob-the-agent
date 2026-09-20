import { askSystemPrompt, mindmapSystemPrompt, summarySystemPrompt } from "../persona.mjs";
import { timeoutSignal } from "../withTimeout.mjs";

const GATE_MODEL_FALLBACK = process.env.GROQ_RESPOND_MODEL || "openai/gpt-oss-120b";

function transcriptBlock(utterances) {
  return utterances.map((u) => `[${u.speaker}] ${u.text}`).join("\n");
}

function memoryBlock(rows) {
  return rows
    .map((r) => `[${new Date(r.ts).toISOString()}] [${r.speaker}] ${r.text}`)
    .join("\n");
}

// Groq's free tier is one token-per-minute budget shared across every call
// this app makes — the hot-path gate/respond calls during a live session
// (or a demo-meeting replay, which fires a real gate+respond per line) AND
// these on-demand summary/mindmap/ask calls all draw from it. A 429 here
// often clears within a couple of seconds, and Groq's own error message
// says exactly how long — parsing that and doing one short retry turns
// many of these transient failures into successes instead of immediately
// giving up to the mock fallback. Deliberately scoped to on-demand calls
// only (this file) — the hot-path gate/respond calls in providers/groq.mjs
// don't retry, since added latency there costs Bob's live responsiveness
// more than it's worth; falling back to mock fast is the right call there.
export function parseRetryAfterMs(body) {
  const match = body.match(/try again in ([\d.]+)(ms|s)\b/i);
  if (!match) return 2000;
  const value = Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
  return Math.min(value, 6000);
}

async function fetchWithRetry(url, options, retries = 1) {
  const res = await fetch(url, options);
  if (res.status === 429 && retries > 0) {
    const body = await res.text().catch(() => "");
    await new Promise((resolve) => setTimeout(resolve, parseRetryAfterMs(body)));
    return fetchWithRetry(url, options, retries - 1);
  }
  return res;
}

// Extracts the first {...} JSON object from a string — Anthropic has no
// strict json-mode like Groq's response_format, so its reply can carry
// stray prose around the object even when asked not to.
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found in model output");
  return JSON.parse(text.slice(start, end + 1));
}

// Distinguishes *why* a mock fallback fired: no key ever configured, vs. a
// key configured but the call itself failed (a rate limit is the common
// case — Groq's free tier is a shared budget across gate/respond calls,
// which fire continuously during a live session, AND summary/mindmap/ask,
// so a burst of manual testing can trip it even with a working key). The
// mock output used to say "no AI key configured" unconditionally, which is
// actively misleading in the rate-limit case — it reads as a config
// problem when the key is fine and the real fix is "wait a few seconds".
// Real bug, found by seeing it happen: caller passes whether ANY key was
// actually configured and attempted (see /api/summary etc. in index.mjs).
function mockLabel(attempted) {
  return attempted
    ? "AI provider temporarily unavailable (likely a rate limit — try again in a few seconds)"
    : "no AI key configured";
}

export function mockSummary(utterances, attempted = false) {
  const humanLines = utterances.filter((u) => u.speaker === "human").length;
  const bobLines = utterances.filter((u) => u.speaker === "bob").length;
  return {
    summary: `Demo summary (${mockLabel(attempted)}): ${utterances.length} lines exchanged (${humanLines} from participants, ${bobLines} from Bob).`,
    keyPoints: utterances.slice(-3).map((u) => u.text),
    actionItems: [],
    source: "mock",
  };
}

export async function groqSummary(utterances, apiKey, template) {
  const res = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GATE_MODEL_FALLBACK,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: summarySystemPrompt(template) },
        { role: "user", content: transcriptBlock(utterances) },
      ],
    }),
    signal: timeoutSignal(15000),
  });
  if (!res.ok) throw new Error(`Groq summary call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  return { summary: "", keyPoints: [], actionItems: [], ...parsed, source: "groq" };
}

export async function sonnetSummary(utterances, apiKey, template) {
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 600,
      system: summarySystemPrompt(template),
      messages: [{ role: "user", content: transcriptBlock(utterances) }],
    }),
    signal: timeoutSignal(15000),
  });
  if (!res.ok) throw new Error(`Sonnet summary call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.map((b) => b.text ?? "").join("") ?? "{}";
  const parsed = extractJson(text);
  return { summary: "", keyPoints: [], actionItems: [], ...parsed, source: "claude-sonnet-5" };
}

// See mockLabel above — same distinction, same reason.
export function mockMindmap(utterances, attempted = false) {
  return {
    root: {
      topic: `Conversation (${mockLabel(attempted)})`,
      children: utterances.slice(0, 5).map((u) => ({ topic: u.text.slice(0, 40), children: [] })),
    },
    source: "mock",
  };
}

export async function groqMindmap(utterances, apiKey) {
  const res = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GATE_MODEL_FALLBACK,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: mindmapSystemPrompt() },
        { role: "user", content: transcriptBlock(utterances) },
      ],
    }),
    signal: timeoutSignal(15000),
  });
  if (!res.ok) throw new Error(`Groq mindmap call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const root = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  return { root, source: "groq" };
}

export async function sonnetMindmap(utterances, apiKey) {
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 800,
      system: mindmapSystemPrompt(),
      messages: [{ role: "user", content: transcriptBlock(utterances) }],
    }),
    signal: timeoutSignal(15000),
  });
  if (!res.ok) throw new Error(`Sonnet mindmap call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.map((b) => b.text ?? "").join("") ?? "{}";
  const root = extractJson(text);
  return { root, source: "claude-sonnet-5" };
}

export function mockAsk(question, attempted = false) {
  return {
    answer: `Demo mode (${mockLabel(attempted)}) — I can't actually search memory right now, but you asked: "${question}".`,
    source: "mock",
  };
}

export async function groqAsk(question, memoryRows, apiKey) {
  const res = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GATE_MODEL_FALLBACK,
      temperature: 0.2,
      messages: [
        { role: "system", content: askSystemPrompt() },
        {
          role: "user",
          content: `Memory excerpts:\n${memoryBlock(memoryRows) || "(none found)"}\n\nQuestion: ${question}`,
        },
      ],
    }),
    signal: timeoutSignal(12000),
  });
  if (!res.ok) throw new Error(`Groq ask call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { answer: data.choices?.[0]?.message?.content?.trim() ?? "", source: "groq" };
}

export async function sonnetAsk(question, memoryRows, apiKey) {
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 400,
      system: askSystemPrompt(),
      messages: [
        {
          role: "user",
          content: `Memory excerpts:\n${memoryBlock(memoryRows) || "(none found)"}\n\nQuestion: ${question}`,
        },
      ],
    }),
    signal: timeoutSignal(12000),
  });
  if (!res.ok) throw new Error(`Sonnet ask call failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.map((b) => b.text ?? "").join("") ?? "";
  return { answer: text.trim(), source: "claude-sonnet-5" };
}
