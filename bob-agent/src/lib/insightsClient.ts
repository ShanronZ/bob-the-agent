import type { AskResult, MemoryRow, MindmapResult, SummaryResult, SummaryTemplate, Speaker } from "../types";
import { apiUrl } from "./apiBase";
import { withTimeout } from "./withTimeout";

// AI recap of a conversation — summary, key points, and action items in one
// call. Summarizes whatever transcript is passed in (normally the current
// session's visible transcript). `template` adapts what counts as a "key
// point" or "action item" to the kind of conversation this was (see the
// picker in Notes.tsx and summarySystemPrompt on the server).
export async function generateSummary(
  utterances: Array<{ speaker: Speaker; text: string }>,
  template: SummaryTemplate = "meeting"
): Promise<SummaryResult> {
  const res = await fetch(apiUrl("/api/summary"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterances, template }),
    signal: withTimeout(undefined, 20000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Summary request failed: ${res.status}`);
  }
  return (await res.json()) as SummaryResult;
}

// Topic hierarchy over a conversation, rendered as a mind map (MindMap.tsx)
// instead of prose — same idea as generateSummary, different shape.
export async function generateMindmap(
  utterances: Array<{ speaker: Speaker; text: string }>
): Promise<MindmapResult> {
  const res = await fetch(apiUrl("/api/mindmap"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ utterances }),
    signal: withTimeout(undefined, 20000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Mind map request failed: ${res.status}`);
  }
  return (await res.json()) as MindmapResult;
}

// Answers a question against Bob's persistent memory (not just the current
// session) — the "Ask Bob" feature.
export async function askBob(question: string): Promise<AskResult> {
  const res = await fetch(apiUrl("/api/ask"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal: withTimeout(undefined, 18000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Ask request failed: ${res.status}`);
  }
  return (await res.json()) as AskResult;
}

// Substring search across everything Bob has ever heard or said.
export async function searchMemory(query: string): Promise<MemoryRow[]> {
  const res = await fetch(apiUrl(`/api/memory/search?q=${encodeURIComponent(query)}`), {
    signal: withTimeout(undefined, 8000),
  });
  if (!res.ok) throw new Error(`Memory search failed: ${res.status}`);
  return (await res.json()) as MemoryRow[];
}
