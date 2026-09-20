import type { Speaker, Utterance } from "../types";
import { apiUrl } from "./apiBase";

interface MemoryRow {
  id: number;
  speaker: Speaker;
  text: string;
  lang: string | null;
  ts: number;
  speakerLabel: string | null;
}

// Loads what Bob remembers from previous sessions so a page refresh (or a
// server restart) doesn't wipe the conversation — see server/memory.mjs.
export async function fetchRecentMemory(limit = 50): Promise<Utterance[]> {
  const res = await fetch(apiUrl(`/api/memory/recent?limit=${limit}`));
  if (!res.ok) throw new Error(`Failed to load memory: ${res.status}`);
  const rows = (await res.json()) as MemoryRow[];
  return rows.map((row) => ({
    id: `db-${row.id}`,
    dbId: row.id,
    text: row.text,
    ts: row.ts,
    isFinal: true,
    speaker: row.speaker,
    speakerLabel: row.speakerLabel ?? undefined,
  }));
}

// Fire-and-forget: persisting a line should never block or break the live
// conversation if the write fails. `onRecorded` is a non-blocking side
// channel for the row id once the write actually completes — the caller
// uses it to make the line retroactively labelable (labelSpeaker below)
// without ever awaiting this call.
export function recordMemory(
  utterance: { speaker: Speaker; text: string; lang: string },
  onRecorded?: (id: number) => void
): void {
  fetch(apiUrl("/api/memory"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(utterance),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { id?: number } | null) => {
      if (body?.id) onRecorded?.(body.id);
    })
    .catch((err) => console.error("failed to persist utterance", err));
}

// Retroactively names who said a "human" line — there's no automatic
// speaker separation (see memory.mjs), so this is manual tagging: someone
// clicks a name onto a transcript line after the fact.
export function labelSpeaker(id: number, label: string): void {
  fetch(apiUrl(`/api/memory/${id}/label`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  }).catch((err) => console.error("failed to label speaker", err));
}

// Wipes everything Bob remembers server-side. Irreversible — the caller is
// expected to confirm with the user first (see App.tsx).
export async function resetMemory(): Promise<void> {
  const res = await fetch(apiUrl("/api/memory"), { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to reset memory: ${res.status}`);
}

export interface MemoryStats {
  total: number;
  humanCount: number;
  bobCount: number;
  oldestTs: number | null;
  newestTs: number | null;
}

// All-time counts, not scoped to the current session — feeds the dashboard.
export async function fetchMemoryStats(): Promise<MemoryStats> {
  const res = await fetch(apiUrl("/api/memory/stats"));
  if (!res.ok) throw new Error(`Failed to load memory stats: ${res.status}`);
  return (await res.json()) as MemoryStats;
}
