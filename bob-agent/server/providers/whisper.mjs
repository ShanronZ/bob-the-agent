import { timeoutSignal } from "../withTimeout.mjs";

// Real multilingual speech understanding — unlike the browser's
// SpeechRecognition (which must be pinned to one language per session and
// garbles anything else), Whisper detects the spoken language directly
// from the audio itself and transcribes accordingly. This is what actually
// lets Bob understand French, English, Spanish, Arabic, etc. without the
// text-based detection/rotation hack in the client being load-bearing for
// correctness — that hack becomes just a fallback for when this is
// unavailable.
export async function transcribeAudio(audioBuffer, mimeType, apiKey) {
  const form = new FormData();
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "wav";
  form.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "verbose_json");
  // Deliberately no `language` field — that's what turns on real auto-detection.

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: timeoutSignal(7000),
  });

  if (!res.ok) {
    throw new Error(`Whisper transcription failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return { text: (data.text ?? "").trim(), language: data.language ?? null };
}
