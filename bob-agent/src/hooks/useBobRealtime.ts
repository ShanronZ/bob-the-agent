import { useCallback, useEffect, useRef, useState } from "react";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { isDirectAddress } from "../lib/directAddress";
import { runDemoMeeting } from "../lib/demoSimulation";
import { checkGate } from "../lib/gateClient";
import { fetchRecentMemory, labelSpeaker, recordMemory, resetMemory } from "../lib/memoryClient";
import { fetchRealtimeInstructions, fetchRealtimeToken } from "../lib/realtimeClient";
import type { BobState, DebugLogEntry, Speaker, Utterance } from "../types";

const CONTEXT_WINDOW = 10;
const MAX_TRANSCRIPT = 30;
// Bob always answers in English (see persona.mjs realtimeInstructions) —
// this is just the label recorded alongside memory entries, matching the
// legacy pipeline's convention.
const RESPONSE_LANG = "en-US";
// The SDK's built-in default model wasn't reaching the actual WebRTC
// connection request (OpenAI rejected it with "you must provide a model
// parameter") — specifying it explicitly here and in the connect() call
// below works around that.
const REALTIME_MODEL = "gpt-realtime";

let idCounter = 0;
const nextId = () => `rt-${Date.now()}-${idCounter++}`;

export interface UseBobRealtimeOptions {
  micOn: boolean;
  voice?: string;
}

// Bob built on OpenAI's Realtime API (WebRTC) instead of the browser's
// SpeechRecognition/SpeechSynthesis + separate Whisper upload. The big win
// over the legacy pipeline: WebRTC's audio path does real echo
// cancellation, so Bob genuinely stops hearing his own voice and
// interruption works natively (interruptResponse below) instead of via the
// text-similarity heuristics the legacy pipeline needs. Transcription
// (whisper-1) is native multilingual, no separate upload/detection step.
//
// What's deliberately kept from the legacy pipeline: the /api/gate call
// (same Groq/GLM/mock cascade) still decides *whether* Bob should speak —
// createResponse is off, so the Realtime session never replies on its own.
// Once the gate says yes, `response.create` tells the Realtime model
// (using the EF persona instructions) to generate *and* speak the reply in
// one step.
export function useBobRealtime({ micOn, voice = "cedar" }: UseBobRealtimeOptions) {
  const [state, setState] = useState<BobState>("idle");
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [demoProgress, setDemoProgress] = useState<{ current: number; total: number } | null>(null);

  const stateRef = useRef<BobState>("idle");
  const setBobState = useCallback((s: BobState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const conversationRef = useRef<Utterance[]>([]);
  const seenItemIdsRef = useRef<Set<string>>(new Set());
  const controllerRef = useRef<AbortController | null>(null);
  const demoControllerRef = useRef<AbortController | null>(null);

  const pushUtterance = useCallback((text: string, speaker: Speaker) => {
    const utterance: Utterance = { id: nextId(), text, ts: Date.now(), isFinal: true, speaker };
    conversationRef.current = [...conversationRef.current, utterance].slice(-MAX_TRANSCRIPT);
    setTranscript(conversationRef.current);
    recordMemory({ speaker, text, lang: RESPONSE_LANG }, (dbId) => {
      conversationRef.current = conversationRef.current.map((u) => (u.id === utterance.id ? { ...u, dbId } : u));
      setTranscript(conversationRef.current);
    });
  }, []);

  // See useBobOrchestrator.ts's relabelSpeaker — same idea, same
  // dbId-gated manual tagging, no automatic diarization on this pipeline
  // either (OpenAI's Realtime API doesn't separate speakers any more than
  // Whisper does).
  const relabelSpeaker = useCallback((utteranceId: string, label: string) => {
    const target = conversationRef.current.find((u) => u.id === utteranceId);
    if (!target?.dbId) return;
    conversationRef.current = conversationRef.current.map((u) =>
      u.id === utteranceId ? { ...u, speakerLabel: label } : u
    );
    setTranscript(conversationRef.current);
    labelSpeaker(target.dbId, label);
  }, []);

  const pushDebugEntry = useCallback((entry: DebugLogEntry) => {
    setDebugLog((log) => [entry, ...log].slice(0, 25));
  }, []);

  useEffect(() => {
    fetchRecentMemory(50)
      .then((rows) => {
        if (rows.length === 0) return;
        conversationRef.current = rows;
        setTranscript(rows);
      })
      .catch((err) => console.error("failed to load memory", err));
  }, []);

  // Same decision logic as the legacy pipeline (see useBobOrchestrator.ts) —
  // only the trigger for *how* Bob speaks differs (response.create over the
  // data channel instead of our own TTS).
  const evaluateAndMaybeRespond = useCallback(
    async (latestUtterance: string, directAddress: boolean) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setBobState("evaluating");

      const recentTranscript = conversationRef.current.slice(-CONTEXT_WINDOW).map((u) => ({
        text: u.speaker === "bob" ? `Bob: ${u.text}` : u.text,
        ts: u.ts,
      }));

      const entryId = nextId();
      const startedAt = performance.now();

      try {
        const decision = await checkGate(
          { recentTranscript, latestUtterance, directAddress, lang: RESPONSE_LANG },
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
          sessionRef.current?.transport.sendEvent({ type: "response.create" });
          // state -> "speaking" is driven by the audio_start event below
        } else {
          setBobState("listening");
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") console.error("gate check failed", err);
        setBobState("listening");
      }
    },
    [pushDebugEntry, setBobState]
  );

  useEffect(() => {
    if (!micOn) {
      sessionRef.current?.close();
      sessionRef.current = null;
      setBobState("idle");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const instructions = await fetchRealtimeInstructions();
        if (cancelled) return;

        const mintToken = () => fetchRealtimeToken(voice);

        const agent = new RealtimeAgent({ name: "bob", instructions });
        const session = new RealtimeSession(agent, {
          apiKey: mintToken,
          transport: "webrtc",
          model: REALTIME_MODEL,
          config: {
            audio: {
              input: {
                // Reverted: adding delay/prompt/noiseReduction here broke
                // the session entirely (nothing transcribed, nothing
                // evaluated) — likely `delay` isn't valid for the
                // non-streaming `whisper-1` model, which would make the
                // whole session.update get rejected, silently dropping
                // turnDetection along with it. Back to the minimal config
                // that's confirmed working; revisit accuracy tuning later,
                // one field at a time, once each can actually be tested.
                transcription: { model: "whisper-1" },
                // We decide *when* Bob replies (createResponse: false, our
                // own gate call below); the API's own server-side VAD still
                // handles *interrupting* him natively (interruptResponse) —
                // real duplex audio, not our text-heuristic barge-in.
                turnDetection: {
                  type: "server_vad",
                  createResponse: false,
                  interruptResponse: true,
                },
              },
              output: { voice },
            },
          },
        });

        // `history_added` fires as soon as an item is created — per the
        // SDK's own docs, "the transcript/response might still be in
        // progress" at that point, so a completed-only check there almost
        // never passes. `history_updated` re-delivers the *full* history on
        // every change instead, so re-scanning it (guarded by
        // seenItemIdsRef so nothing is double-processed) reliably catches
        // each item the moment it actually finishes, whenever that is.
        session.on("history_updated", (history) => {
          for (const item of history) {
            if (item.type !== "message") continue;
            if (seenItemIdsRef.current.has(item.itemId)) continue;

            if (item.role === "user" && item.status === "completed") {
              const audioContent = item.content.find((c) => c.type === "input_audio");
              const text = audioContent?.transcript?.trim();
              if (!text) continue;
              seenItemIdsRef.current.add(item.itemId);
              pushUtterance(text, "human");
              void evaluateAndMaybeRespond(text, isDirectAddress(text));
            } else if (item.role === "assistant" && item.status === "completed") {
              const audioContent = item.content.find((c) => c.type === "output_audio");
              const text = audioContent?.transcript?.trim();
              if (!text) continue;
              seenItemIdsRef.current.add(item.itemId);
              pushUtterance(text, "bob");
            }
          }
        });

        session.on("audio_start", () => setBobState("speaking"));
        session.on("audio_stopped", () => {
          if (stateRef.current === "speaking") setBobState("listening");
        });
        session.on("audio_interrupted", () => setBobState("listening"));
        session.on("error", (e) => {
          console.error("realtime session error", e);
          setConnectionError(String(e.error));
        });
        // Some failures (e.g. a session.update the API rejects) don't
        // surface through the "error" event above and instead show up only
        // as a raw error-type event on the wire — logging these is the only
        // way to see the API's actual rejection reason when that happens.
        // Check the browser console (F12) if Bob goes silent with no
        // "Connexion impossible" message shown.
        session.on("transport_event", (event) => {
          if (typeof event.type === "string" && event.type.includes("error")) {
            console.error("realtime transport error event", event);
          }
        });

        await session.connect({ apiKey: mintToken, model: REALTIME_MODEL });
        if (cancelled) {
          session.close();
          return;
        }
        sessionRef.current = session;
        setConnectionError(null);
        setBobState("listening");
      } catch (err) {
        console.error("failed to start realtime session", err);
        if (!cancelled) {
          setConnectionError((err as Error).message);
          setBobState("idle");
        }
      }
    })();

    return () => {
      cancelled = true;
      sessionRef.current?.close();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, voice]);

  // Wipes local state, the server's memory DB, *and* the live session's own
  // tracked history (OpenAI keeps its own context window for the duration
  // of the WebRTC connection — without clearing that too, Bob would still
  // silently remember the "erased" conversation until the connection drops).
  const resetConversation = useCallback(async () => {
    controllerRef.current?.abort();
    demoControllerRef.current?.abort();
    seenItemIdsRef.current = new Set();
    conversationRef.current = [];
    setTranscript([]);
    setDebugLog([]);
    sessionRef.current?.updateHistory([]);
    await resetMemory();
  }, []);

  // Replays a scripted 4-person business meeting through the real gate +
  // respond pipeline (see demoSimulation.ts) — text-only, independent of
  // whether the WebRTC session is connected, so it works with the mic off.
  // Clears whatever's currently there first, same as "New conversation".
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
        pushUtterance,
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

  return { state, transcript, debugLog, connectionError, demoProgress, resetConversation, loadDemoMeeting, relabelSpeaker };
}
