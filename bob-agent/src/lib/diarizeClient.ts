import { apiUrl } from "./apiBase";
import { withTimeout } from "./withTimeout";

export interface DiarizeResult {
  speakers: number;
  labeled: number;
}

// Uploads the whole session's continuous recording so far (see
// useAudioCapture's getFullRecording) for one-shot speaker diarization —
// unlike transcription, this only works meaningfully over one continuous
// file (see providers/deepgram.mjs), so it's a deliberate, occasional,
// user-triggered action rather than something that runs per-utterance.
export async function diarizeSession(blob: Blob, sessionStartTs: number): Promise<DiarizeResult> {
  const res = await fetch(apiUrl(`/api/diarize?sessionStartTs=${sessionStartTs}`), {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/webm" },
    body: blob,
    signal: withTimeout(undefined, 45000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Diarization failed: ${res.status}`);
  }
  return (await res.json()) as DiarizeResult;
}
