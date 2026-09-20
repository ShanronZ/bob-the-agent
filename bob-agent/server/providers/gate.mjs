import { gateSystemPrompt } from "../persona.mjs";
import { timeoutSignal } from "../withTimeout.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Keyword matching stays multilingual (people can address Bob in any
// language Whisper understands), but the displayed reason text is always
// English — the whole UI is English now, so the debug panel shouldn't
// switch language depending on what was said.
const IMPORTANT_KEYWORDS = [
  "wrong",
  "mistake",
  "incorrect",
  "urgent",
  "important",
  "deadline",
  "how much",
  "why",
  "how do we",
  "english",
  "abroad",
  "exchange",
  "study",
  "erreur",
  "faux",
  "attention",
  "date limite",
  "combien",
  "pourquoi",
  "comment on fait",
  "anglais",
  "sejour",
  "echange",
];

const REASONS = {
  direct: "Someone is talking directly to Bob.",
  keyword: (kw) => `Flagged as relevant: keyword "${kw}".`,
  none: "Nothing here is worth interrupting the conversation for.",
};

// Rule-based stand-in for the real gate model, used whenever ZHIPU_API_KEY
// is not set so the app runs out of the box.
export async function mockGate({ latestUtterance, directAddress }) {
  await delay(150 + Math.random() * 200);

  if (directAddress) {
    return {
      shouldRespond: true,
      reason: REASONS.direct,
      category: "direct_address",
      source: "mock",
    };
  }

  const lower = latestUtterance.toLowerCase();
  const hit = IMPORTANT_KEYWORDS.find((kw) => lower.includes(kw));
  if (hit) {
    return {
      shouldRespond: true,
      reason: REASONS.keyword(hit),
      category: "important_insight",
      source: "mock",
    };
  }

  return {
    shouldRespond: false,
    reason: REASONS.none,
    category: "none",
    source: "mock",
  };
}

// Real gate call to GLM-5.3-Flash (Zhipu / Z.ai), used whenever ZHIPU_API_KEY
// is configured. The endpoint/schema follows Zhipu's OpenAI-compatible chat
// completions API — double check against current docs before shipping,
// this was not verified against a live account.
export async function glmGate({ recentTranscript, latestUtterance, directAddress }, apiKey) {
  const res = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "glm-5.3-flash",
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
    throw new Error(`GLM gate call failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  return { ...parsed, source: "glm-5.3-flash" };
}
