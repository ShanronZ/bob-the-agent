import { apiUrl } from "./apiBase";
import { withTimeout } from "./withTimeout";

// Mints a short-lived client secret server-side (the real OPENAI_API_KEY
// never reaches the browser) — passed as a function to RealtimeSession so
// the SDK can call it fresh on every (re)connect. The full session config
// (persona, forced English, manual response control, and this voice) is
// baked in at mint time server-side — see server/index.mjs for why.
export async function fetchRealtimeToken(voice: string): Promise<string> {
  const res = await fetch(apiUrl("/api/realtime-token"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ voice }),
    signal: withTimeout(undefined, 10000),
  });
  if (!res.ok) throw new Error(`Failed to mint realtime token: ${res.status}`);
  const data = (await res.json()) as { value: string };
  return data.value;
}

// Bob's persona (bob-prompt.md) lives server-side only — fetched once so
// the client never duplicates it.
export async function fetchRealtimeInstructions(): Promise<string> {
  const res = await fetch(apiUrl("/api/realtime/instructions"), {
    signal: withTimeout(undefined, 8000),
  });
  if (!res.ok) throw new Error(`Failed to load realtime instructions: ${res.status}`);
  const data = (await res.json()) as { instructions: string };
  return data.instructions;
}
