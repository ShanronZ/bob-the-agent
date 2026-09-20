import { useCallback, useEffect, useRef, useState } from "react";
import { isDirectAddress } from "../lib/directAddress";
import { runDemoMeeting } from "../lib/demoSimulation";
import { checkGate } from "../lib/gateClient";
import { streamResponse } from "../lib/responseClient";
import { SentenceSplitter } from "../lib/sentenceSplitter";
import { isLikelyEcho } from "../lib/textSimilarity";
import { detectLanguage } from "../lib/detectLanguage";
import { diarizeSession } from "../lib/diarizeClient";
import { fetchRecentMemory, labelSpeaker, recordMemory, resetMemory } from "../lib/memoryClient";
import { transcribeAudio } from "../lib/transcribeClient";
import { useAudioCapture } from "./useAudioCapture";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useSpeechSynthesis } from "./useSpeechSynthesis";
import type { BobState, DebugLogEntry, Speaker, Utterance } from "../types";

const MAX_TRANSCRIPT = 30;
const CONTEXT_WINDOW = 10;
// How long to wait after the last sentence before deciding Bob might have
// something to add. Direct address ("Bob, ...") skips this entirely.
const DEBOUNCE_MS = 1200;
// Safety window after Bob stops talking during which a recognized utterance
// that looks like what he just said is treated as mic bleed, not a new turn.
const ECHO_WINDOW_MS = 3000;
// Bob always speaks English, no matter what language he's listening for —
// `lang` below only ever controls speech *recognition* (what he understands).
const RESPONSE_LANG = "en-US";
// Languages considered for automatic input-language detection (see
// detectLanguage.ts). en-GB is deliberately left out here — text alone
// can't distinguish it from en-US, so detection always lands on en-US and
// the GB variant stays a manual-only pick.
const DETECTABLE_LANGS = ["fr-FR", "en-US", "es-ES", "de-DE"];
// If recognition is stuck on the wrong language, everything it transcribes
// comes out garbled (wrong phonemes forced into the wrong word model), and
// garbled text doesn't confidently match ANY language's stopwords — so
// text-based detection alone can never recover once stuck. This forces a
// try-the-next-candidate rotation whenever nothing has matched confidently
// for a while, so it can't get stuck forever with no manual override left.
const ROTATE_MS = 7000;

let idCounter = 0;
const nextId = () => `${Date.now()}-${idCounter++}`;

export interface UseBobOrchestratorOptions {
  lang: string;
  micOn: boolean;
  // Without real echo cancellation, keeping the mic live while Bob talks
  // means anything YOU say at the same time gets picked up mixed with his
  // voice, which can garble your own speech recognition — not just make
  // Bob hear himself. Off by default: mic mutes while he speaks, which is
  // the reliable option; on trades that reliability for the ability to cut
  // him off mid-sentence.
  allowInterrupt: boolean;
  // Manual voice pick from the UI's voice list; null/undefined falls back
  // to the automatic male-voice heuristic.
  preferredVoice?: SpeechSynthesisVoice | null;
  // Called when a recognized utterance looks confidently like a different
  // language than `lang` — the caller (App) updates `lang` in response, so
  // recognition self-corrects onto the right language without the user
  // having to pick one.
  onLangDetected?: (lang: string) => void;
}

export function useBobOrchestrator({
  lang,
  micOn,
  allowInterrupt,
  preferredVoice,
  onLangDetected,
}: UseBobOrchestratorOptions) {
  const [state, setState] = useState<BobState>("idle");
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [interim, setInterimState] = useState("");
  const interimRef = useRef("");
  const setInterim = useCallback((text: string) => {
    interimRef.current = text;
    setInterimState(text);
  }, []);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [demoProgress, setDemoProgress] = useState<{ current: number; total: number } | null>(null);
  const [identifyLoading, setIdentifyLoading] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);

  const stateRef = useRef<BobState>("idle");
  const setBobState = useCallback((s: BobState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const conversationRef = useRef<Utterance[]>([]);
  const debounceTimerRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingEntryIdRef = useRef<string | null>(null);
  const demoControllerRef = useRef<AbortController | null>(null);

  // What Bob is currently saying / just finished saying — used both to show
  // his lines in the transcript and to recognize the mic hearing itself.
  const spokenSoFarRef = useRef("");
  const lastBobUtteranceRef = useRef<{ text: string; endedAt: number } | null>(null);

  // Language rotation state — see ROTATE_MS above.
  const lastConfidentDetectionRef = useRef(Date.now());
  const rotationIndexRef = useRef(0);

  const pushUtterance = useCallback((text: string, speaker: Speaker, lang: string) => {
    const utterance: Utterance = { id: nextId(), text, ts: Date.now(), isFinal: true, speaker };
    conversationRef.current = [...conversationRef.current, utterance].slice(-MAX_TRANSCRIPT);
    setTranscript(conversationRef.current);
    recordMemory({ speaker, text, lang }, (dbId) => {
      conversationRef.current = conversationRef.current.map((u) => (u.id === utterance.id ? { ...u, dbId } : u));
      setTranscript(conversationRef.current);
    });
    return utterance;
  }, []);

  // No automatic diarization (see types.ts's Utterance.speakerLabel) — this
  // is what a click-to-name on a transcript line (TranscriptFeed.tsx) calls.
  // Requires dbId because the label is persisted against the DB row, not
  // the client-local id; that's normally present within milliseconds of the
  // line appearing (see the onRecorded callback above), so the UI simply
  // disables the control until then rather than queuing anything.
  const relabelSpeaker = useCallback((utteranceId: string, label: string) => {
    const target = conversationRef.current.find((u) => u.id === utteranceId);
    if (!target?.dbId) return;
    conversationRef.current = conversationRef.current.map((u) =>
      u.id === utteranceId ? { ...u, speakerLabel: label } : u
    );
    setTranscript(conversationRef.current);
    labelSpeaker(target.dbId, label);
  }, []);

  // Bob remembers past sessions, not just the current one: load recent
  // history from the server's SQLite database once on mount so a page
  // refresh (or restarting the server) doesn't wipe the conversation.
  useEffect(() => {
    fetchRecentMemory(50)
      .then((rows) => {
        if (rows.length === 0) return;
        conversationRef.current = rows;
        setTranscript(rows);
      })
      .catch((err) => console.error("failed to load memory", err));
  }, []);

  const pushDebugEntry = useCallback((entry: DebugLogEntry) => {
    setDebugLog((log) => [entry, ...log].slice(0, 25));
  }, []);

  // Records audio per-utterance for Whisper — see useAudioCapture.ts for
  // why this runs alongside SpeechRecognition instead of replacing it.
  const audioCapture = useAudioCapture(micOn);

  // One-shot automatic diarization over the whole session's recording so
  // far (see useAudioCapture's getFullRecording) — fills in "Speaker N"
  // placeholders on human lines nobody's named yet; relabelSpeaker above
  // is how those placeholders get turned into real names afterward. Only
  // meaningful with DEEPGRAM_API_KEY configured server-side; without it
  // this surfaces the same 503 the server returns.
  const identifySpeakers = useCallback(async () => {
    const recording = audioCapture.getFullRecording();
    if (!recording) {
      setIdentifyError("Nothing recorded yet this session.");
      return;
    }
    setIdentifyLoading(true);
    setIdentifyError(null);
    try {
      await diarizeSession(recording.blob, recording.sessionStartTs);
      const rows = await fetchRecentMemory(50);
      if (rows.length > 0) {
        conversationRef.current = rows;
        setTranscript(rows);
      }
    } catch (err) {
      setIdentifyError(err instanceof Error ? err.message : "Failed to identify speakers");
    } finally {
      setIdentifyLoading(false);
    }
  }, [audioCapture]);

  const tts = useSpeechSynthesis(
    RESPONSE_LANG,
    () => {
      if (stateRef.current !== "speaking") return;
      const spoken = spokenSoFarRef.current.trim();
      spokenSoFarRef.current = "";
      if (spoken) {
        pushUtterance(spoken, "bob", RESPONSE_LANG);
        lastBobUtteranceRef.current = { text: spoken, endedAt: Date.now() };
      }
      setBobState("listening");
    },
    preferredVoice
  );

  const clearDebounce = () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  // The mic stays on while Bob talks (see useSpeechRecognition below) so he
  // can be interrupted — this is what stops him from treating his own voice,
  // picked up through the speakers, as someone else talking.
  const isEcho = useCallback((candidate: string) => {
    if (stateRef.current === "speaking" && spokenSoFarRef.current) {
      if (isLikelyEcho(candidate, spokenSoFarRef.current)) return true;
    }
    const lastBob = lastBobUtteranceRef.current;
    if (lastBob && Date.now() - lastBob.endedAt < ECHO_WINDOW_MS && isLikelyEcho(candidate, lastBob.text)) {
      return true;
    }
    return false;
  }, []);

  // Shared by the interim fast-path and the final-result fallback below.
  const bargeIn = useCallback(() => {
    tts.cancel();
    // Keep a record of what Bob was cut off saying — without this, the
    // *next* recognized result (often the delayed "final" for the same
    // audio that just triggered this barge-in via its interim) has nothing
    // to compare against in isEcho() once state flips away from "speaking",
    // so it slips through as a "new" utterance and can re-trigger Bob,
    // which barges into itself again, etc. — a self-interruption loop.
    const spoken = spokenSoFarRef.current.trim();
    if (spoken) lastBobUtteranceRef.current = { text: spoken, endedAt: Date.now() };
    spokenSoFarRef.current = "";
    controllerRef.current?.abort();
    setDebugLog((log) => {
      const [last, ...rest] = log;
      if (!last) return log;
      return [{ ...last, interrupted: true }, ...rest];
    });
    setBobState("listening");
  }, [setBobState, tts]);

  const evaluate = useCallback(
    async (latestUtterance: string, directAddress: boolean, startedAt: number) => {
      clearDebounce();
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setBobState("evaluating");

      const recentTranscript = conversationRef.current.slice(-CONTEXT_WINDOW).map((u) => ({
        text: u.speaker === "bob" ? `Bob: ${u.text}` : u.text,
        ts: u.ts,
      }));

      const entryId = nextId();
      pendingEntryIdRef.current = entryId;

      const splitter = new SentenceSplitter();
      let bufferedText = "";
      let released = false;

      const speak = (sentence: string) => {
        spokenSoFarRef.current += sentence + " ";
        tts.enqueue(sentence);
      };

      const respondTask = streamResponse(
        { recentTranscript, latestUtterance, gateReason: "", directAddress, lang },
        (chunk) => {
          bufferedText += chunk;
          if (released) {
            for (const sentence of splitter.push(chunk)) speak(sentence);
          }
        },
        controller.signal
      ).catch((err) => {
        if ((err as Error)?.name !== "AbortError") console.error("respond stream failed", err);
      });

      try {
        const decision = await checkGate(
          { recentTranscript, latestUtterance, directAddress, lang },
          controller.signal
        );

        if (controller.signal.aborted) return;

        pushDebugEntry({
          id: entryId,
          ts: Date.now(),
          utterance: latestUtterance,
          directAddress,
          decision,
          spoke: decision.shouldRespond,
          totalLatencyMs: performance.now() - startedAt,
        });

        if (decision.shouldRespond) {
          released = true;
          spokenSoFarRef.current = "";
          setBobState("speaking");
          for (const sentence of splitter.push(bufferedText)) speak(sentence);
          await respondTask;
          const rest = splitter.flush();
          if (rest) speak(rest);
        } else {
          controller.abort();
          setBobState("listening");
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") console.error("gate check failed", err);
        setBobState("listening");
      }
    },
    [pushDebugEntry, setBobState, tts, lang]
  );

  const handleFinalUtterance = useCallback(
    async (text: string) => {
      // Whisper (audio-based, real multilingual understanding) takes
      // priority over the browser's own guess (text-based, pinned to one
      // language) whenever it's available — this is what actually lets Bob
      // understand a language he isn't currently "listening for" instead of
      // transcribing it as gibberish in the wrong one.
      const blob = await audioCapture.stopSegment();
      let trimmed = text.trim();
      if (blob) {
        const whisperResult = await transcribeAudio(blob);
        if (whisperResult?.text) trimmed = whisperResult.text;
      }

      if (!trimmed) return;
      if (isEcho(trimmed)) return;
      const startedAt = performance.now();

      pushUtterance(trimmed, "human", lang);
      setInterim("");

      // Deliberately NOT using Whisper's own per-utterance language label
      // here — it's known to be unreliable on short clips (misclassified a
      // correctly-flavored clip as "Indonesian" during testing) and using it
      // directly made the detected language flip around on every utterance
      // even when the transcription itself was fine. The stopword-based
      // check below, run on Whisper's now-accurate text, is far steadier —
      // it requires multiple real word matches, not a single model guess.
      const detected = detectLanguage(trimmed, DETECTABLE_LANGS);
      if (detected) {
        lastConfidentDetectionRef.current = Date.now();
        if (detected !== lang) onLangDetected?.(detected);
      }

      const directAddress = isDirectAddress(trimmed);

      if (stateRef.current === "speaking") {
        // Usually already handled by handleInterim below, faster — this is
        // just the fallback in case no interim fired before the final did.
        bargeIn();
      }

      if (directAddress) {
        void evaluate(trimmed, true, startedAt);
        return;
      }

      if (stateRef.current === "listening" || stateRef.current === "idle") {
        clearDebounce();
        debounceTimerRef.current = window.setTimeout(() => {
          void evaluate(trimmed, false, startedAt);
        }, DEBOUNCE_MS);
      }
      // If Bob is currently evaluating/speaking for a different reason,
      // this utterance stays in the transcript and will simply be part of
      // the context for the next evaluation — we don't fire overlapping
      // gate calls.
    },
    [audioCapture, bargeIn, evaluate, isEcho, pushUtterance, setInterim, lang, onLangDetected]
  );

  // Reacts to *interim* (in-progress) results instead of waiting for a
  // final transcript, so Bob gets cut off within a couple hundred ms of
  // someone starting to talk instead of only after their whole sentence has
  // been recognized — that shrinks how long two voices actually overlap in
  // the mic, which is the real source of the garbling reported when
  // allowInterrupt is on. Requires 3+ words before reacting — this runs on
  // the browser's own (less reliable than Whisper) guess, and a short
  // fragment is exactly what a mis-heard echo of Bob's own voice looks like.
  const handleInterim = useCallback(
    (text: string) => {
      setInterim(text);
      if (stateRef.current !== "speaking") return;
      const trimmed = text.trim();
      if (trimmed.split(/\s+/).length < 3) return;
      if (isEcho(trimmed)) return;
      bargeIn();
    },
    [bargeIn, isEcho, setInterim]
  );

  // See allowInterrupt above: muted while speaking by default (no self-
  // hearing, no interference with your own speech), or left on if the user
  // explicitly wants barge-in — isEcho()/handleInterim are the best-effort
  // filter and fast-path for that mode, but they can't fully undo two
  // voices hitting the mic at once without real echo cancellation.
  const { supported } = useSpeechRecognition({
    lang,
    active: micOn && (allowInterrupt || state !== "speaking"),
    onFinalUtterance: handleFinalUtterance,
    onInterim: handleInterim,
  });

  // See ROTATE_MS above: without this, a wrong `lang` can never self-correct
  // once recognition starts producing garbled, unmatchable text. Skips while
  // someone is actively mid-utterance (interim has content) — recreating
  // the recognition instance then would cut off whatever they're saying.
  useEffect(() => {
    if (!micOn) return;
    const interval = window.setInterval(() => {
      if (interimRef.current.trim()) return;
      if (Date.now() - lastConfidentDetectionRef.current < ROTATE_MS) return;
      rotationIndexRef.current = (rotationIndexRef.current + 1) % DETECTABLE_LANGS.length;
      onLangDetected?.(DETECTABLE_LANGS[rotationIndexRef.current]);
    }, ROTATE_MS);
    return () => window.clearInterval(interval);
  }, [micOn, onLangDetected]);

  useEffect(() => {
    if (micOn) {
      setBobState("listening");
    } else {
      clearDebounce();
      controllerRef.current?.abort();
      tts.cancel();
      spokenSoFarRef.current = "";
      setBobState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn]);

  // Wipes everything — in-flight requests, what's on screen, and Bob's
  // long-term memory in the database — so the next utterance starts a
  // genuinely clean conversation. The confirmation dialog is the caller's
  // job (see App.tsx); this just does it.
  const resetConversation = useCallback(async () => {
    clearDebounce();
    controllerRef.current?.abort();
    demoControllerRef.current?.abort();
    tts.cancel();
    spokenSoFarRef.current = "";
    lastBobUtteranceRef.current = null;
    conversationRef.current = [];
    setTranscript([]);
    setDebugLog([]);
    setInterim("");
    setBobState(micOn ? "listening" : "idle");
    await resetMemory();
  }, [micOn, setBobState, setInterim, tts]);

  // Replays a scripted 4-person business meeting through the real gate +
  // respond pipeline (see demoSimulation.ts) — text-only, no TTS playback,
  // works with the mic off. Clears whatever's currently there first, same
  // as "New conversation".
  const loadDemoMeeting = useCallback(async () => {
    // resetConversation() itself aborts demoControllerRef — must run BEFORE
    // the new controller is created and assigned, otherwise it immediately
    // cancels the very run it's part of and runDemoMeeting silently no-ops
    // on its first signal.aborted check.
    demoControllerRef.current?.abort();
    await resetConversation();
    const controller = new AbortController();
    demoControllerRef.current = controller;
    setDemoProgress({ current: 0, total: 0 });
    try {
      await runDemoMeeting({
        getRecentTranscript: () =>
          conversationRef.current.slice(-CONTEXT_WINDOW).map((u) => ({
            text: u.speaker === "bob" ? `Bob: ${u.text}` : u.text,
            ts: u.ts,
          })),
        pushUtterance: (text, speaker) => pushUtterance(text, speaker, RESPONSE_LANG),
        pushDebugEntry,
        onProgress: (current, total) => setDemoProgress({ current, total }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") console.error("demo meeting failed", err);
    } finally {
      setDemoProgress(null);
    }
  }, [pushUtterance, pushDebugEntry, resetConversation]);

  return {
    state,
    transcript,
    interim,
    debugLog,
    supported,
    voiceStatus: tts.voiceStatus,
    demoProgress,
    resetConversation,
    loadDemoMeeting,
    relabelSpeaker,
    identifySpeakers,
    identifyLoading,
    identifyError,
  };
}
