import { useCallback, useEffect, useRef } from "react";

// Records raw audio for Whisper transcription, alongside (not instead of)
// the browser's SpeechRecognition — that API still does turn detection
// (when someone starts/stops talking) and serves as the fallback
// transcript, but the actual words come from here since it's language-
// agnostic where SpeechRecognition is pinned to one language.
//
// Recording starts the moment the mic turns on and never actually stops
// during a listening session — it only gets *cut* into one Blob per
// utterance when stopSegment() is called, which immediately starts the
// next segment. This is deliberate: waiting for the browser's own interim
// result to fire before starting to record (the original design) meant
// recording began after the browser had already noticed speech, which
// itself lags real speech by several hundred ms — clipping the start of
// every utterance. Recording continuously means a segment might contain a
// bit of leading silence from the previous pause, which costs nothing.
export function useAudioCapture(active: boolean) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // A second, never-cut recorder on the same stream, purely for on-demand
  // speaker diarization (see getFullRecording below and /api/diarize).
  // Diarization only stays consistent across turns within one continuous
  // file — the per-utterance segments above are each an independent
  // MediaRecorder run and can't be reassembled into one valid file by
  // concatenating their bytes, so this runs in parallel instead of reusing
  // them. Started with an explicit timeslice (unlike the segment recorder)
  // so chunks actually accumulate over time instead of only arriving once,
  // on stop — this recorder is never stopped until the mic itself is off.
  const fullRecorderRef = useRef<MediaRecorder | null>(null);
  const fullChunksRef = useRef<Blob[]>([]);
  const sessionStartRef = useRef<number | null>(null);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start();
      recorderRef.current = recorder;
    } catch (err) {
      console.error("failed to start audio recording", err);
    }
  }, []);

  const beginFullRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    try {
      const recorder = new MediaRecorder(stream);
      fullChunksRef.current = [];
      sessionStartRef.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) fullChunksRef.current.push(e.data);
      };
      recorder.start(1000);
      fullRecorderRef.current = recorder;
    } catch (err) {
      console.error("failed to start full-session recording", err);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      recorderRef.current?.stop();
      recorderRef.current = null;
      fullRecorderRef.current?.stop();
      fullRecorderRef.current = null;
      fullChunksRef.current = [];
      sessionStartRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }

    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        beginRecording();
        beginFullRecording();
      })
      .catch((err) => console.error("mic access for transcription failed", err));

    return () => {
      cancelled = true;
      recorderRef.current?.stop();
      recorderRef.current = null;
      fullRecorderRef.current?.stop();
      fullRecorderRef.current = null;
      fullChunksRef.current = [];
      sessionStartRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [active, beginRecording, beginFullRecording]);

  // Cuts the current segment and immediately starts recording the next one
  // — call this once an utterance's final transcript comes in.
  const stopSegment = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder) {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type: recorder.mimeType }) : null;
        chunksRef.current = [];
        resolve(blob);
        beginRecording();
      };
      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
  }, [beginRecording]);

  // Snapshot of everything recorded so far this session, for on-demand
  // speaker diarization — non-destructive and callable more than once.
  // Each call re-sends the whole session so far (not just what's new)
  // because that's what keeps Deepgram's speaker numbering consistent
  // across repeated clicks; see the note in providers/deepgram.mjs.
  const getFullRecording = useCallback((): { blob: Blob; sessionStartTs: number } | null => {
    const recorder = fullRecorderRef.current;
    if (!recorder || fullChunksRef.current.length === 0 || sessionStartRef.current == null) return null;
    return { blob: new Blob(fullChunksRef.current, { type: recorder.mimeType }), sessionStartTs: sessionStartRef.current };
  }, []);

  return { stopSegment, getFullRecording };
}
