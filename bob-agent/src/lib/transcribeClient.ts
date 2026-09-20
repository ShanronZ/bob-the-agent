import { apiUrl } from "./apiBase";
import { withTimeout } from "./withTimeout";

const TIMEOUT_MS = 8000;

export interface TranscriptionResult {
  text: string;
  language: string | null;
}

// Uploads one utterance's recorded audio for real multilingual
// transcription (Whisper via the backend). Returns null if unavailable
// (no server key, network error, or — critically — a hung request that
// never resolves, which without this timeout would stall the whole
// pipeline waiting for it) so callers fall back to the browser's own
// SpeechRecognition text instead of getting stuck.
export async function transcribeAudio(blob: Blob): Promise<TranscriptionResult | null> {
  try {
    const res = await fetch(apiUrl("/api/transcribe"), {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
      signal: withTimeout(undefined, TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as TranscriptionResult;
  } catch {
    return null;
  }
}
