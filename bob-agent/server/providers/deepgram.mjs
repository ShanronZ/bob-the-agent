import { timeoutSignal } from "../withTimeout.mjs";

// Real speaker diarization over one continuous recording — unlike Whisper
// (providers/whisper.mjs), which returns one flat transcript with no notion
// of "who said this". Deepgram's speaker clustering only stays consistent
// WITHIN one continuous audio file (see useAudioCapture.ts's
// getFullRecording) — separate per-utterance clips sent as independent
// requests would each restart speaker numbering from zero and never agree
// with each other across turns, which is why this is a deliberate,
// occasional, whole-session call instead of running per-utterance like
// transcription does.
export async function diarizeAudio(audioBuffer, mimeType, apiKey) {
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&diarize=true&punctuate=true&utterances=true",
    {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": mimeType },
      body: audioBuffer,
      signal: timeoutSignal(30000),
    }
  );
  if (!res.ok) {
    throw new Error(`Deepgram diarization failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const utterances = data.results?.utterances ?? [];
  // { start, end, speaker } in seconds relative to the start of this
  // recording. Deepgram's own transcript text is discarded — Whisper (or
  // the browser) already produced the text we display and store, so all
  // we need from here is which speaker cluster was talking when.
  return utterances.map((u) => ({ start: u.start, end: u.end, speaker: u.speaker }));
}

// Matches each candidate utterance to the diarized segment it's temporally
// closest to (by distance to the segment's midpoint) — our own utterance
// boundaries come from the browser's own pause detection and are recorded
// at the moment the utterance is judged *finished*, so they never line up
// exactly with Deepgram's own VAD segmentation. Nearest-match is far more
// robust than requiring strict containment in a [start, end] window, and
// degrades gracefully at a speaker-change boundary instead of matching
// nothing. Pure/deterministic on purpose — the actual HTTP call above
// isn't unit-tested (no live Deepgram account in CI), but this is the part
// most likely to have an off-by-one or an empty-input bug, and it doesn't
// need a network to test.
export function matchUtterancesToSpeakers(rows, segments, sessionStartTs) {
  if (segments.length === 0) return [];
  const matches = [];
  for (const row of rows) {
    const offsetSec = (row.ts - sessionStartTs) / 1000;
    if (offsetSec < 0) continue;
    let best = segments[0];
    let bestDist = Infinity;
    for (const s of segments) {
      const dist = Math.abs(offsetSec - (s.start + s.end) / 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = s;
      }
    }
    matches.push({ id: row.id, speaker: best.speaker });
  }
  return matches;
}
