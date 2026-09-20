import { respondSystemPrompt } from "../persona.mjs";
import { timeoutSignal } from "../withTimeout.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const OPINION_TEMPLATES = [
  (u) => `Honestly? On "${u}" I'd say go for it — waiting usually costs more than trying and adjusting later.`,
  (u) => `My take: "${u}" sounds workable, but I'd set a clear limit before committing fully.`,
  (u) => `I'm leaning yes here. "${u}" — the risk of moving looks smaller than the risk of staying stuck.`,
];

const INSIGHT_TEMPLATES = [
  (u) => `Quick note — on "${u}", there's something worth double-checking before you go further.`,
  (u) => `Sorry to jump in, but on "${u}" that's worth verifying before you decide.`,
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Mock reply used when ANTHROPIC_API_KEY is not set. Always in English —
// Bob answers in English no matter what language he was addressed in — and
// picks templates by the reason Bob was triggered, so even the demo mode
// sounds like it's taking a real position instead of a vague filler line.
export async function mockRespond({ latestUtterance, directAddress }, onChunk, shouldAbort) {
  const templates = directAddress ? OPINION_TEMPLATES : INSIGHT_TEMPLATES;
  const text = pick(templates)(latestUtterance);

  for (const word of text.split(" ")) {
    if (shouldAbort?.()) return;
    await delay(55);
    onChunk(word + " ");
  }
}

// Real response generation via Claude Sonnet 5, streamed. Only spoken once
// the gate has already decided Bob should speak (see server/index.mjs) —
// but the fetch is kicked off in parallel with the gate check on the
// client, so tokens are already buffering by the time the gate answers.
export async function sonnetRespond({ recentTranscript, latestUtterance, gateReason }, onChunk, apiKey, shouldAbort) {
  const system = respondSystemPrompt(gateReason);

  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, timeoutSignal(15000)]);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      // See groq.mjs's groqRespond for why this isn't 250 anymore.
      max_tokens: 320,
      system,
      stream: true,
      messages: [
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
    throw new Error(`Sonnet call failed: ${res.status} ${await res.text()}`);
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
        if (event.type === "content_block_delta" && event.delta?.text) {
          onChunk(event.delta.text);
        }
      } catch {
        // ignore malformed/partial SSE lines
      }
    }
  }
}
