import type { RespondRequestBody } from "../types";
import { apiUrl } from "./apiBase";
import { withTimeout } from "./withTimeout";

const TIMEOUT_MS = 15000;

// Streams the draft response text as it is generated. This is fired in
// parallel with the gate check (see useBobOrchestrator) — if the gate says
// "no", the caller aborts via `signal` and nothing is ever spoken.
export async function streamResponse(
  body: RespondRequestBody,
  onChunk: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(apiUrl("/api/respond"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(signal, TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Respond request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) onChunk(chunk);
  }
}
