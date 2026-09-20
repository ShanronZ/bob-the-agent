import { gateSystemPrompt, respondSystemPrompt } from "../persona.mjs";
import { timeoutSignal } from "../withTimeout.mjs";

// Groq has a genuinely free, ongoing (no credit card) tier for open models
// with an OpenAI-compatible endpoint — a solid $0 fallback for both the
// gate and the response generator while a paid key (GLM, Sonnet) isn't
// available. Model name is env-configurable since Groq's free lineup
// changes over time; check console.groq.com/docs/models for the current
// list if the default below has been retired.
const GATE_MODEL = process.env.GROQ_GATE_MODEL || "openai/gpt-oss-20b";
const RESPOND_MODEL = process.env.GROQ_RESPOND_MODEL || "openai/gpt-oss-120b";

export async function groqGate({ recentTranscript, latestUtterance, directAddress }, apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GATE_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: gateSystemPrompt() },
        {
          role: "user",
          content: JSON.stringify({ recentTranscript, latestUtterance, directAddress }),
        },
      ],
    }),
    signal: timeoutSignal(6000),
  });

  if (!res.ok) {
    throw new Error(`Groq gate call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  return { ...parsed, source: "groq" };
}

export async function groqRespond({ recentTranscript, latestUtterance, gateReason }, onChunk, apiKey, shouldAbort) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, timeoutSignal(15000)]);
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: RESPOND_MODEL,
      stream: true,
      // 250 was clipping longer 3-sentence replies mid-word (seen live during
      // a simulated-meeting test on an "important_insight" turn) — 320 gives
      // headroom without inviting genuinely long answers, since the prompt
      // itself already caps replies at 1-3 spoken sentences.
      max_tokens: 320,
      messages: [
        { role: "system", content: respondSystemPrompt(gateReason) },
        {
          role: "user",
          content: `Contexte recent de la conversation:\n${recentTranscript
            .map((t) => `- ${t.text}`)
            .join("\n")}\n\nDerniere phrase: ${latestUtterance}`,
        },
      ],
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Groq respond call failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (shouldAbort?.()) {
      controller.abort();
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // ignore malformed/partial SSE lines
      }
    }
  }
}
